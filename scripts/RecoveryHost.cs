using System;
using System.Diagnostics;
using System.IO;

// Compiled as a Windows GUI executable so Task Scheduler never creates a console.
// Wait for the check and preserve its exit code for Task Scheduler diagnostics.
internal static class RecoveryHost
{
    private static string Quote(string path)
    {
        if (path.IndexOf('"') >= 0) throw new ArgumentException("Invalid path");
        int trailing = 0;
        for (int i = path.Length - 1; i >= 0 && path[i] == '\\'; i--) trailing++;
        return "\"" + path + new string('\\', trailing) + "\"";
    }

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 2) return 2;
            string script = Path.GetFullPath(args[0]);
            string data = Path.GetFullPath(args[1]);
            if (!File.Exists(script)) return 2;
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                    @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "
                    + Quote(script) + " -DataDirectory " + Quote(data),
                WorkingDirectory = Path.GetDirectoryName(script),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (var child = Process.Start(start))
            {
                if (child == null) return 1;
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch { return 1; }
    }
}
