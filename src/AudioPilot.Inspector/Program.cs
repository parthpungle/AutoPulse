using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using AudioPilot.Core;
using AudioPilot.WindowsAudio;

namespace AudioPilot.Inspector;

internal static class Program
{
    // Core Audio session enumeration runs on a COM multithreaded apartment.
    [MTAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--help"))
        {
            Console.WriteLine("AudioPilot Inspector: [--json] [--watch] [--all-sessions]");
            Console.WriteLine("Read-only. --watch samples every two seconds; Ctrl+C stops.");
            return 0;
        }
        if (args.Any(arg => arg is not ("--json" or "--watch" or "--all-sessions")))
        {
            Console.Error.WriteLine("Unknown argument. Use --help for usage.");
            return 2;
        }
        if (!OperatingSystem.IsWindows())
        {
            Console.Error.WriteLine("AudioPilot Inspector requires Windows.");
            return 1;
        }

        using var stop = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Cancel(); };
        var json = new JsonSerializerOptions
        {
            WriteIndented = !args.Contains("--watch"),
            Converters = { new JsonStringEnumConverter() }
        };
        try
        {
            var inspector = new WindowsAudioInspector();
            do
            {
                var snapshot = inspector.Capture();
                if (args.Contains("--json"))
                    Console.WriteLine(JsonSerializer.Serialize(snapshot, json));
                else
                    Print(snapshot, args.Contains("--all-sessions"));
                if (!args.Contains("--watch")) break;
            } while (!stop.Token.WaitHandle.WaitOne(TimeSpan.FromSeconds(2)));
            return 0;
        }
        catch (Exception ex) when (ex is COMException or InvalidOperationException)
        {
            Console.Error.WriteLine($"Audio inspection failed: {ex.Message} (0x{ex.HResult:X8})");
            return 1;
        }
    }

    private static void Print(AudioSnapshot snapshot, bool allSessions)
    {
        Console.WriteLine($"\nAudioPilot Device Inspector v0.0.1 | {snapshot.CapturedAt:T}");
        Console.WriteLine("READ-ONLY • Windows-reported metadata\n\nPLAYBACK DEVICES");
        if (snapshot.Devices.Count == 0) Console.WriteLine("  No playback endpoints found.");
        foreach (var device in snapshot.Devices)
        {
            Console.WriteLine($"\n  {device.Name}\n    State: {device.State}");
            Console.WriteLine($"    Default roles: {(device.DefaultRoles.Count == 0 ? "None" : string.Join(", ", device.DefaultRoles))}");
            Console.WriteLine($"    Endpoint ID: {device.Id}");
            Console.WriteLine(device.SharedMixFormat is { } mix
                ? $"    Shared engine mix: {mix.Channels} channels, {mix.SampleRate:N0} Hz, {mix.ContainerBits}-bit container"
                : "    Shared engine mix: Unknown / unavailable");
        }
        Console.WriteLine(allSessions ? "\nAUDIO SESSIONS" : "\nACTIVE AUDIO SESSIONS");
        var sessions = snapshot.Sessions.Where(s => allSessions || s.State == "Active").ToArray();
        if (sessions.Length == 0) Console.WriteLine("  No matching sessions at this instant.");
        foreach (var session in sessions)
            Console.WriteLine($"  {session.Application} (PID {session.ProcessId}) → {session.EndpointName}\n    {session.State} | Volume {session.Volume:P0} | Muted: {session.Muted}");
        Console.WriteLine("\nContent codec, Atmos state, connection type, and bit-perfect playback: Unknown.");
        Console.WriteLine("Active session state does not prove audible sound; shared mix is not the source format.");
        foreach (var warning in snapshot.Warnings)
            Console.WriteLine($"  Warning [{warning.Scope}]: {warning.Message}");
    }
}
