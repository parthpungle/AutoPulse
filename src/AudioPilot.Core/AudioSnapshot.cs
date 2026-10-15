namespace AudioPilot.Core;

public sealed record MixFormat(int Channels, int SampleRate, int ContainerBits);

public sealed record PlaybackDevice(
    string Id, string Name, string State, IReadOnlyList<string> DefaultRoles,
    MixFormat? SharedMixFormat);

public sealed record AudioSession(
    string EndpointId, string EndpointName, string InstanceId, uint ProcessId,
    string Application, string State, float Volume, bool Muted);

public sealed record InspectionWarning(string Scope, string Message);

public sealed record AudioSnapshot(
    DateTimeOffset CapturedAt, IReadOnlyList<PlaybackDevice> Devices,
    IReadOnlyList<AudioSession> Sessions, IReadOnlyList<InspectionWarning> Warnings);

public interface IAudioInspector
{
    AudioSnapshot Capture();
}
