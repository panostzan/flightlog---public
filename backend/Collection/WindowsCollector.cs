using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Flightlog;

public sealed class WindowsCollector(EventStore store, Settings settings, DiagnosticLog log) : BackgroundService
{
    string session=Guid.NewGuid().ToString(); long seq; Stopwatch clock=Stopwatch.StartNew();
    readonly object gate=new(); bool locked; bool suspended; public string Health { get; private set; }="starting";
    public bool Paused => settings.WindowsPaused;
    void SetHealth(string health,Exception? error=null) { if(Health!=health) log.Write("windows_"+health,error); Health=health; }
    void Emit(string kind,object data)
    {
        var e=Observation.Create(settings.WindowsSourceId,session,++seq,clock.Elapsed.TotalMilliseconds,kind,data);
        store.Insert([e],false);
    }
    void Boundary(string state,string reason) => Emit("sensor.boundary",new {state,reason,lost_count=(int?)null});
    public void Pause(bool pause)
    {
        lock(gate)
        {
            if(settings.WindowsPaused==pause) return;
            Boundary(pause?"paused":"resumed",pause?"user_pause":"recovery");
            settings.WindowsPaused=pause; settings.Version++; settings.Save(); NewSession();
            SetHealth(pause?"paused":"starting");
        }
    }
    void NewSession() { session=Guid.NewGuid().ToString(); seq=0; clock.Restart(); }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var notifications=new SessionNotifications((state,reason)=>
        {
            lock(gate)
            {
                try {
                    Boundary(state,reason);
                    log.Write("windows_"+reason);
                    if(reason=="session_lock") locked=true;
                    if(reason=="session_unlock") locked=false;
                    if(reason=="suspend") suspended=true;
                    if(reason=="resume") suspended=false;
                    NewSession();
                }
                catch(Exception ex) { SetHealth("storage_error",ex); locked=true; }
            }
        });
        lock(gate) Boundary("started","launch");
        try
        {
            while(!stoppingToken.IsCancellationRequested)
            {
                lock(gate)
                {
                    try
                    {
                        if(!settings.WindowsPaused && !locked && !suspended)
                        {
                            Emit("windows.state",Sample()); SetHealth(notifications.Ready?"ok":"session_notifications_unavailable");
                        }
                        else SetHealth(settings.WindowsPaused?"paused":"locked");
                    }
                    catch(Exception ex) { SetHealth("storage_error",ex); NewSession(); }
                }
                await Task.Delay(1000,stoppingToken);
            }
        }
        catch(OperationCanceledException) { }
        finally { lock(gate) { try { Boundary("stopped","shutdown"); } catch(Exception ex) { log.Write("windows_shutdown_error",ex); } log.Write("windows_stopped"); } }
    }
    object Sample()
    {
        object Empty(string status)=>new {status,exe=(string?)null,pid=(int?)null,hwnd=(string?)null,title=(string?)null};
        var hwnd=GetForegroundWindow(); if(hwnd==0) return Empty("unavailable");
        try
        {
            GetWindowThreadProcessId(hwnd,out var pid);
            using var process=Process.GetProcessById((int)pid);
            var exe=process.ProcessName+".exe";
            if(settings.ExcludedExecutables.Contains(exe,StringComparer.OrdinalIgnoreCase)) return Empty("excluded");
            string? title=null;
            if(!exe.Equals("chrome.exe",StringComparison.OrdinalIgnoreCase) && settings.TitleExecutables.Contains(exe,StringComparer.OrdinalIgnoreCase))
            { var text=new StringBuilder(513); GetWindowText(hwnd,text,text.Capacity); title=text.ToString(); }
            if(hwnd!=GetForegroundWindow()) return Empty("unavailable");
            return new { status="available",exe,pid=(int?)pid,hwnd=hwnd.ToString(),title };
        }
        catch { return Empty("unavailable"); }
    }
    [DllImport("user32.dll")] static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(nint hwnd,out uint pid);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(nint hwnd,StringBuilder text,int count);
}

// A hidden top-level window receives broadcasts; a message-only window would miss power broadcasts.
sealed class SessionNotifications : IDisposable
{
    readonly Thread thread; readonly Action<string,string> report; readonly WndProc callback; nint window;
    public bool Ready { get; private set; }
    public SessionNotifications(Action<string,string> report)
    {
        this.report=report; callback=WindowProc;
        thread=new Thread(Run) { IsBackground=true,Name="Flightlog session notifications" }; thread.Start();
    }
    void Run()
    {
        var name="Flightlog-"+Guid.NewGuid(); var wc=new WNDCLASS { lpfnWndProc=Marshal.GetFunctionPointerForDelegate(callback),lpszClassName=name };
        if(RegisterClass(ref wc)==0) return;
        window=CreateWindowEx(0,name,"",0,0,0,0,0,0,0,0,0);
        if(window==0) { UnregisterClass(name,0); return; }
        Ready=WTSRegisterSessionNotification(window,0);
        while(GetMessage(out var msg,0,0,0)>0) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
        WTSUnRegisterSessionNotification(window); DestroyWindow(window); UnregisterClass(name,0); Ready=false;
    }
    nint WindowProc(nint hwnd,uint msg,nuint wp,nint lp)
    {
        if(msg==0x02B1)
        {
            if(wp==7) report("locked","session_lock");
            if(wp==8) report("resumed","session_unlock");
        }
        if(msg==0x0218)
        {
            if(wp==4) report("locked","suspend");
            if(wp is 7 or 18) report("resumed","resume");
        }
        if(msg==0x0010) { PostQuitMessage(0); return 0; }
        return DefWindowProc(hwnd,msg,wp,lp);
    }
    public void Dispose() { if(window!=0) PostMessage(window,0x0010,0,0); thread.Join(1500); }
    delegate nint WndProc(nint hwnd,uint msg,nuint wp,nint lp);
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct WNDCLASS { public uint style; public nint lpfnWndProc; public int cbClsExtra,cbWndExtra; public nint hInstance,hIcon,hCursor,hbrBackground; public string? lpszMenuName; public string lpszClassName; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public nint hwnd; public uint message; public nuint wParam; public nint lParam; public uint time; public int x,y; public uint lPrivate; }
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern ushort RegisterClass(ref WNDCLASS wc);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool UnregisterClass(string name,nint instance);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern nint CreateWindowEx(uint ex,string cls,string title,uint style,int x,int y,int w,int h,nint parent,nint menu,nint instance,nint param);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg,nint hwnd,uint min,uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern nint DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern nint DefWindowProc(nint hwnd,uint msg,nuint wp,nint lp);
    [DllImport("user32.dll")] static extern bool DestroyWindow(nint hwnd);
    [DllImport("user32.dll")] static extern bool PostMessage(nint hwnd,uint msg,nuint wp,nint lp);
    [DllImport("user32.dll")] static extern void PostQuitMessage(int code);
    [DllImport("wtsapi32.dll")] static extern bool WTSRegisterSessionNotification(nint hwnd,uint flags);
    [DllImport("wtsapi32.dll")] static extern bool WTSUnRegisterSessionNotification(nint hwnd);
}
