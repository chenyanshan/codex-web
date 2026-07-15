# PWA Setup

Use this after Codex Web is already running on your Mac.

Base URL examples:

- Local browser on the Mac: `http://127.0.0.1:43210`
- Phone: an `https://` URL from your own reverse proxy, tunnel, or private
  network HTTPS endpoint

Do not enter the Codex Web password over plain LAN HTTP. It exposes the password
and bearer token to the network, and non-localhost HTTP is not a secure context
for Service Workers. TLS setup stays outside this repository, but HTTPS is a
prerequisite for the phone PWA workflow below.

## iPhone Or iPad

1. Open the Codex Web URL in Safari.
2. Log in once so the app can store its session token for this device.
3. Tap the Share button.
4. Choose `Add to Home Screen`.
5. Open the saved icon from the Home Screen for the standalone PWA experience.

## Android

1. Open the Codex Web URL in Chrome.
2. Log in once.
3. Open the browser menu.
4. Choose `Install app` or `Add to Home screen`.
5. Launch the installed shortcut/app from the Android launcher.

## Notes

- The phone must be able to reach the Mac on the configured host and port.
- `http://<your-mac-lan-ip>:43210` may be useful for unauthenticated reachability
  diagnostics on a trusted LAN, but it is not a supported login or PWA URL.
- If the app fails to connect after installing, reopen it in the browser once
  and confirm the server is still running.
- If you change the host or port in `~/.config/codex-web/service.env`, reinstall
  the home-screen shortcut so you do not keep an outdated entry point.
