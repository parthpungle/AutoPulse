# AudioPilot

Windows audio inspection and, eventually, quality-aware routing. The full product
vision lives in [README_AudioPilot.md](README_AudioPilot.md).

The first implementation is a **read-only console inspector**. It lists playback
endpoints (including disabled and disconnected ones), default roles, shared-engine
mix formats, and audio sessions across every active playback endpoint. It reads
session volume and mute state without changing either.

## Build and run

Requires Windows and the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
or a newer SDK capable of targeting .NET 8. Visual Studio is optional. NuGet access
is required on the first build to restore NAudio.Wasapi 2.2.1.

```powershell
dotnet build AudioPilot.sln
dotnet run --project src/AudioPilot.Inspector
dotnet run --project src/AudioPilot.Inspector -- --all-sessions
dotnet run --project src/AudioPilot.Inspector -- --watch
dotnet run --project src/AudioPilot.Inspector -- --json
```

`--watch` polls every two seconds. Stop with Ctrl+C. Combine `--watch --json`
for newline-delimited JSON snapshots. JSON includes all non-expired sessions;
`--all-sessions` controls only the text view. Exit codes: 0 success, 1 inspection
failure, 2 invalid arguments. Partial failures are returned in snapshot warnings.

## What the output means

- Endpoint and session observations come directly from Windows via NAudio.
- The endpoint associated with a session is its observed output at capture time.
- A default output role does not prove that every application uses that output.
- An active session can be silent or muted; this is not an audible-sound detector.
- The shared mix format describes the Windows engine, not the source codec,
  maximum hardware capability, exclusive stream format, or bit-perfect playback.
- Connection type, Atmos capability/state, Bluetooth codec, and protected content
  format are unknown in this milestone. No name-based capability guesses.

## Structure and status

- `AudioPilot.Core`: immutable snapshot models and inspector contract.
- `AudioPilot.WindowsAudio`: native Core Audio metadata reads through NAudio.
- `AudioPilot.Inspector`: console presentation and polling.
- [Windows audio research](docs/windows-audio-research.md).
- [Validation checklist](docs/validation.md).

Source implementation is complete for the initial inspector; compilation and
hardware validation are pending because the initial environment has no .NET SDK.
Routing, profiles, GUI, overlay, rollback, and automatic changes are future work.
Validate this milestone before adding routing, as required by the product roadmap.
