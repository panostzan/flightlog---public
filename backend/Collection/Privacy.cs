using System.Net;

namespace Flightlog;

public static class Privacy
{
    public static bool ExcludedHost(string host, IEnumerable<string> exclusions)
    {
        var h = host.TrimEnd('.').Trim('[', ']').ToLowerInvariant();
        if (h == "localhost" || h.EndsWith(".localhost") || exclusions.Any(x => h == x || h.EndsWith("." + x))) return true;
        if (!IPAddress.TryParse(h, out var ip)) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip) || ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any)) return true;
        var b = ip.GetAddressBytes();
        return b.Length == 4 ? b[0] is 0 or 10 or 127 || b[0] >= 224 || (b[0] == 169 && b[1] == 254) ||
            (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168) || (b[0] == 100 && b[1] >= 64 && b[1] <= 127)
            : (b[0] & 0xfe) == 0xfc || (b[0] == 0xfe && (b[1] & 0xc0) == 0x80) || b[0] == 0xff;
    }
    public static bool SearchHost(string provider, string host) => provider switch
    {
        "google" => host is "www.google.com" or "google.com" or "www.google.ca" or "google.ca",
        "bing" => host is "www.bing.com" or "bing.com",
        "duckduckgo" => host is "duckduckgo.com" or "www.duckduckgo.com", _ => false
    };
}
