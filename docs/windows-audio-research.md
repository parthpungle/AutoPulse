# Windows audio research: initial inspector

## First milestone

AudioPilot runs beside the audio stream. The inspector performs metadata reads
without capturing, initializing, mixing, resampling, or re-encoding playback.
NAudio.Wasapi 2.2.1 wraps the Windows COM interfaces and is the only direct package
dependency. The console entry point runs on an MTA thread for session enumeration.

## Interfaces

- [IMMDeviceEnumerator](https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nn-mmdeviceapi-immdeviceenumerator)
  enumerates render endpoints and retrieves console, multimedia, and communications
  defaults. Enumerate all states; only query formats and sessions on active devices.
- [IAudioSessionManager2](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nn-audiopolicy-iaudiosessionmanager2)
  exposes sessions per endpoint. Inspect every active endpoint to avoid missing
  applications routed away from the default output.
- [IAudioSessionControl2](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nn-audiopolicy-iaudiosessioncontrol2)
  exposes process and session identity. System sounds have their own label;
  terminated or inaccessible processes fall back to a PID label.
- [IAudioClient.GetMixFormat](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclient-getmixformat)
  reports the shared engine mix. Container bits can describe float samples;
  they must not be presented as source bit depth or hardware fidelity.
- [NAudio source](https://github.com/naudio/NAudio/tree/v2.2.1/NAudio.Wasapi/CoreAudioApi)
  documents the wrapper's API and disposal behavior.

## Boundaries and next research

Session state indicates a running stream, not actual audible samples. Polling is
a snapshot and can miss short sessions. Device removal or session expiration
between reads produces scoped warnings; a total enumeration failure exits nonzero.
The watch loop performs fresh enumeration each cycle to discover new sessions.

Atmos-ready hardware is not proof that Atmos content is playing. Spatial output
format queries and supported-format probes require a separate capability module.
Never infer HDMI, receiver model, or a Bluetooth codec solely from a friendly name.

Per-app routing is deferred: Windows policy interfaces used by some utilities can
be undocumented or version-sensitive. Before implementation, establish an OS
compatibility matrix, snapshot/restore semantics, and verification on a Windows VM.
Use physical hardware for HDMI/spatial capability validation. GUI and overlay
should consume the same snapshot contract rather than opening their own streams.
