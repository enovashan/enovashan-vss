# Enovashan: Reel downloads to MEGA

This is a local utility, not a cloud download service. Keep your computer awake,
the helper terminal open, and the CMS open during transfers. Use only videos you
own or have permission to download and store. Private/restricted videos may fail;
the helper does not import social-media cookies, request social-media passwords,
or bypass access restrictions.

## 1. Create your MEGA account

1. Open <https://mega.nz/register>, create your account, and verify your email.
2. Save your recovery key securely and enable two-factor authentication.
3. In your MEGA Cloud Drive, create a folder named `Enovashan Reels`.
4. Check you have enough storage. MEGA account limits still apply.

Your password is never entered into the CMS. MEGAcmd maintains its own local
session/cache: protect your computer account and disk. The helper does not
implement a separate credential vault or read your MEGA session credentials.

## 2. Install the tools on Windows

Node.js is already available on the Windows computer used for this setup.
Other computers need Node.js 22 or later from <https://nodejs.org/>.

Open PowerShell and install these tools using their official instructions:

- yt-dlp: <https://github.com/yt-dlp/yt-dlp/wiki/Installation>
- FFmpeg: <https://ffmpeg.org/download.html>
- MEGAcmd: <https://mega.nz/cmd>

If you use Windows Package Manager, the first two can be installed with:

```powershell
winget install --id yt-dlp.yt-dlp --exact
winget install --id Gyan.FFmpeg --exact
```

Install MEGAcmd using the official Windows installer. Close and reopen PowerShell
after installation so it sees the updated PATH. Check:

```powershell
node --version
yt-dlp --version
ffmpeg -version
```

Open the **MEGAcmd** application from the Start menu. At its own interactive
prompt, type `login your-email@example.com`. Let MEGAcmd prompt for your password
and two-factor code. Do not put your password in a command, script, chat, or CMS.
Then type `whoami` to confirm login. Keep MEGAcmd available while using the helper.
If MEGAcmd asks to resume or authorize a session, complete that locally.

The helper finds `MegaClient.exe` through PATH or the usual MEGAcmd installation
in your Local AppData or Program Files folder. If installed elsewhere, add that
installation directory to your user PATH and open a new terminal.

## 3. Install the tools on macOS

Install Node.js 22 or later, yt-dlp, FFmpeg, and MEGAcmd.
If you already use Homebrew:

```sh
brew install node yt-dlp ffmpeg
```

Download the official macOS MEGAcmd installer from <https://mega.nz/cmd> and follow
its installation instructions. Open the MEGAcmd application and sign in at its
interactive prompt using `login your-email@example.com`, then enter your password
and two-factor code when prompted. Confirm with `whoami`.

In a new Terminal, check `node --version`, `yt-dlp --version`, and `ffmpeg -version`.
The helper looks for the `mega-*` scriptable commands on PATH and in
`/Applications/MEGAcmd.app/Contents/MacOS`. If your installation differs, add its
scriptable-command directory to PATH. Windows and macOS maintain separate local
MEGA sessions and destination settings.

## 4. Download and start the helper

In CMS > **Video Downloads**, click **Download local helper**. Keep the `.cjs`
extension. No npm packages or Python scripts are required by this helper itself.
yt-dlp and FFmpeg are separate tools.

In Windows PowerShell, assuming your browser saved it to Downloads:

```powershell
node "$env:USERPROFILE\Downloads\enovashan-video-helper.cjs"
```

On macOS, assuming the same download location:

```sh
node ~/Downloads/enovashan-video-helper.cjs
```

If your browser used another folder or filename, use that actual path.
The terminal prints a **Connect CMS** link and a manual 64-character **pairing
code**. Ctrl+click the link on Windows (Command+click on Mac) to open the CMS and
pair automatically after signing in. If your terminal does not support clicking,
open that complete link in your browser. Treat the link and code like temporary
passwords: do not share or bookmark them. They change on every helper restart.
Download the latest helper if your existing copy only prints a manual code.

The helper listens only on `127.0.0.1:47831`. Do not expose that port through a
router, tunnel, proxy, or public server. Only the production Enovashan CMS origins
are allowed to call it, and API requests must include the pairing code.

## 5. Pair and select the destination

1. Click the helper's **Connect CMS** link in current Chrome or Edge.
2. Sign in if prompted. **Video Downloads** opens and connects automatically.
3. Alternatively, open the CMS manually, select **Video Downloads**, paste the
   manual code, and click **Connect helper**.
4. Allow access to the local network if your browser asks. Browser/enterprise
   policies can block this connection; do not disable browser security globally.
5. Confirm yt-dlp, FFmpeg, and MEGA login all show **Ready**.
6. Click **Browse MEGA folders**, select `/Enovashan Reels`, then **Save destination**.
   The folder is remembered locally across helper restarts. Create new folders in
   MEGA, then browse again. This is a cloud-folder picker, not a local disk picker.

No MEGA password, pairing code, Reel queue, or video is stored in Supabase/Vercel.
The pairing code is held in the CMS page's memory only. The Connect CMS link uses
a URL fragment, which browsers do not send in HTTP requests; the CMS removes it
from the address bar immediately. After a refresh, click the helper's link again
or pair manually. Do not share the link, screenshots of it, or the terminal output.

## 6. Run your first transfer

1. Start with **one public Reel you own or have permission to download**.
2. Paste its full Instagram `/reel/...` or Facebook `/reel/...` or `/share/r/...`
   link. Supported Facebook hosts include `www`, `m`, and `web`.
3. Check the permission confirmation and submit.
4. Watch `Pending` -> `Downloading` -> `Uploading` -> **Ok** or **Failed**.
5. Open your MEGA folder and confirm the MP4 is there.
6. Once the single-video test works, submit up to 50 links, one per line.

Files are named with the queue entry's unique ID to avoid collisions and unsafe
titles. The queue shows the destination filename. The helper downloads and uploads
one video at a time. Limits are 10 minutes and 500 MB per finished video; downloads
can temporarily use more space for separate audio/video streams and conversion.
Each download/upload command times out after 30 minutes.

**Ok** means the blocking MEGAcmd upload command succeeded, the remote file could
be listed, and the local temporary files were removed. This is not a separate
cryptographic remote-content audit. An unavailable, login-required, unsupported,
oversized video, network failure, or MEGA quota issue produces **Failed** with a
reason.

## 7. Failures, cleanup, and restarting

- Failed files stay locally for retry. **Retry** reuses a completed MP4 if available.
- If upload succeeded but cleanup failed, the error says so; Retry only cleans up.
- **Discard temp files & remove** deletes the local job files and removes its row.
  It never deletes the video in MEGA.
- Completed rows can be removed without deleting their MEGA files.
- Stopping/restarting the helper marks unfinished jobs **Failed** rather than
  restarting automatically. Check MEGA before retrying: if interruption occurred
  after upload but before recording success, a retry can create a new file version.
- Disconnecting or closing the CMS does not cancel helper work. To monitor it
  again, click the same running helper's Connect CMS link or pair manually.
- Finish or allow transfers to fail before stopping the helper with Ctrl+C.
- The helper retains up to 500 queue entries. Remove finished/failed entries to
  make room. There is no automatic permanent storage of successful local videos.

The helper stores only its destination, queue, errors, and staging files in
`.enovashan-video-helper` inside your home directory. This directory is local,
outside the website repository. Do not delete it while the helper is running.

If tools are not found, fix PATH and restart the helper. If downloads stop working
after a platform change, update yt-dlp through the same installation method you
used. Reels are not guaranteed to work: Facebook/Instagram can change formats,
require login, rate-limit requests, or refuse downloads.

## Verification before relying on this setup

Automated tests use simulated transfers and cannot prove your account or a
particular Reel works. Complete the single-video test above on Windows, then repeat
on your Mac. macOS and browser local-network behavior must be checked on the actual
devices. Never send your MEGA password, recovery key, or two-factor codes for help.
