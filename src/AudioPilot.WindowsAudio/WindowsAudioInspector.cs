using System.Diagnostics;
using System.Runtime.InteropServices;
using AudioPilot.Core;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace AudioPilot.WindowsAudio;

/// <summary>Reads endpoint and session metadata; never opens or modifies an audio stream.</summary>
public sealed class WindowsAudioInspector : IAudioInspector
{
    public AudioSnapshot Capture()
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("AudioPilot requires Windows.");

        var devices = new List<PlaybackDevice>();
        var sessions = new List<AudioSession>();
        var warnings = new List<InspectionWarning>();
        using var enumerator = new MMDeviceEnumerator();
        var defaults = new Dictionary<Role, string>();
        foreach (var role in Enum.GetValues<Role>())
        {
            try
            {
                using var endpoint = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, role);
                defaults[role] = endpoint.ID;
            }
            catch (COMException ex)
            {
                warnings.Add(new($"Default {role}", Describe(ex)));
            }
        }

        foreach (var endpoint in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.All))
        {
            using (endpoint)
            {
                try
                {
                    var id = endpoint.ID;
                    var name = endpoint.FriendlyName;
                    var state = endpoint.State;
                    MixFormat? format = null;
                    if (state == DeviceState.Active)
                    {
                        try
                        {
                            using var client = endpoint.AudioClient;
                            var mix = client.MixFormat;
                            format = new(mix.Channels, mix.SampleRate, mix.BitsPerSample);
                        }
                        catch (Exception ex) when (IsReadFailure(ex))
                        {
                            warnings.Add(new(name + " mix format", Describe(ex)));
                        }
                    }
                    devices.Add(new(id, name, state.ToString(),
                        defaults.Where(pair => pair.Value == id).Select(pair => pair.Key.ToString()).ToArray(), format));
                    if (state == DeviceState.Active)
                        ReadSessions(endpoint, id, name, sessions, warnings);
                }
                catch (Exception ex) when (IsReadFailure(ex))
                {
                    warnings.Add(new("Playback endpoint", Describe(ex)));
                }
            }
        }
        return new(DateTimeOffset.Now, devices, sessions, warnings);
    }

    private static void ReadSessions(MMDevice endpoint, string id, string name,
        List<AudioSession> result, List<InspectionWarning> warnings)
    {
        try
        {
            var collection = endpoint.AudioSessionManager.Sessions;
            for (var index = 0; index < collection.Count; index++)
            {
                try
                {
                    using var session = collection[index];
                    var state = session.State;
                    if (state == AudioSessionState.AudioSessionStateExpired) continue;
                    var pid = session.GetProcessID;
                    var application = session.IsSystemSoundsSession ? "System sounds" : ProcessName(pid);
                    result.Add(new(id, name, session.GetSessionInstanceIdentifier, pid, application,
                        state == AudioSessionState.AudioSessionStateActive ? "Active" : "Inactive",
                        session.SimpleAudioVolume.Volume, session.SimpleAudioVolume.Mute));
                }
                catch (Exception ex) when (IsReadFailure(ex))
                {
                    warnings.Add(new($"{name} session {index}", Describe(ex)));
                }
            }
        }
        catch (Exception ex) when (IsReadFailure(ex))
        {
            warnings.Add(new(name + " sessions", Describe(ex)));
        }
    }

    private static string ProcessName(uint pid)
    {
        try
        {
            using var process = Process.GetProcessById(checked((int)pid));
            return process.ProcessName + ".exe";
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException
            or System.ComponentModel.Win32Exception or OverflowException)
        {
            return $"Unknown process (PID {pid})";
        }
    }

    private static bool IsReadFailure(Exception ex) => ex is COMException
        or InvalidOperationException or UnauthorizedAccessException;

    private static string Describe(Exception ex) => $"{ex.Message} (0x{ex.HResult:X8})";
}
