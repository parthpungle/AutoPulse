# Inspector validation

Compilation and live hardware checks are pending until a .NET SDK is available.
No automated pass or real-device validation is claimed.

## Build checks

```powershell
dotnet build AudioPilot.sln --configuration Release
dotnet run --project src/AudioPilot.Inspector -- --help
dotnet run --project src/AudioPilot.Inspector -- --invalid
```

Expected: build succeeds; help exits 0; invalid arguments exit 2.

## Windows VM / physical Windows smoke checks

1. Compare device names and default roles with Windows Sound settings. Disabled
   and unplugged endpoints should appear with their reported state.
2. Play audio in two applications. Both should appear, with their actual endpoint
   and the volume/mute values shown in Windows Volume Mixer.
3. Route an application using Windows settings to another endpoint. The next
   snapshot should associate its session with that endpoint.
4. Pause playback, mute, and close the apps. Observe session state without assuming
   every paused app immediately becomes inactive. Closed processes must not crash
   the inspector. Use `--all-sessions` to inspect inactive sessions.
5. During `--watch`, start another app and connect/disconnect an output. New state
   should appear within a polling cycle; transient failures should produce warnings.
6. Test no active outputs. Missing defaults should produce scoped warnings, and
   the inspector should still list any disabled/disconnected endpoints.
7. Run `--json`; parse with `ConvertFrom-Json`. With `--watch --json`, each line
   must be an independently valid snapshot. Ctrl+C should stop cleanly.
8. Compare Windows settings before and after. Output selection, routes, formats,
   volume, mute, and spatial settings must remain unchanged.

Do not mark the README's detection milestones validated until these checks pass.
