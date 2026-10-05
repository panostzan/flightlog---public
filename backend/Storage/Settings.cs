using System.Security.Cryptography;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;

namespace Flightlog;

public sealed class Settings
{
    public int Version { get; set; } = 1;
    public string Token { get; set; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    public string WindowsSourceId { get; set; } = Guid.NewGuid().ToString();
    public string? BrowserSourceId { get; set; }
    public string? ExtensionOrigin { get; set; }
    public bool WindowsPaused { get; set; }
    public string[] ExcludedExecutables { get; set; } = [];
    public string[] TitleExecutables { get; set; } = [];
    [System.Text.Json.Serialization.JsonIgnore] public string DirectoryPath { get; set; } = "";
    public static Settings Load(string directory)
    {
        PrepareDirectory(directory);
        var path = Path.Combine(directory, "settings.local.json");
        var settings = File.Exists(path) ? JsonSerializer.Deserialize<Settings>(File.ReadAllText(path), Observation.Json)! : new Settings();
        settings.DirectoryPath = directory;
        if (settings.Token.Length != 64 || !Guid.TryParse(settings.WindowsSourceId, out _)) throw new InvalidOperationException("invalid_settings");
        settings.Save(); return settings;
    }
    public static void PrepareDirectory(string directory)
    {
        Directory.CreateDirectory(directory);
        if (OperatingSystem.IsWindows())
        {
            var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false);
            acl.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User!, FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            new DirectoryInfo(directory).SetAccessControl(acl);
        }
    }
    public void Save()
    {
        var historyPath=Path.Combine(DirectoryPath,"capture-settings-history.json");
        var capture=JsonSerializer.SerializeToElement(new { windows_paused=WindowsPaused, excluded_executables=ExcludedExecutables, title_executables=TitleExecutables },Observation.Json);
        var history=File.Exists(historyPath) ? JsonSerializer.Deserialize<List<CaptureRevision>>(File.ReadAllText(historyPath),Observation.Json)! : [];
        if(history.Count==0 || !JsonElement.DeepEquals(history[^1].Capture,capture))
        {
            if(history.Count>0) Version=Math.Max(Version,history[^1].Version+1);
            history.Add(new(Version,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),capture));
            File.WriteAllText(historyPath+".tmp",JsonSerializer.Serialize(history,Observation.Json));
            File.Move(historyPath+".tmp",historyPath,true);
        }
        var path = Path.Combine(DirectoryPath, "settings.local.json");
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(this, Observation.Json));
        File.Move(path + ".tmp", path, true);
    }
}
record CaptureRevision(int Version,long ChangedAtMs,JsonElement Capture);
