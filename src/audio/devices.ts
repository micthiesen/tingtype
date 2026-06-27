export interface AudioInputDevice {
  index: number;
  /** Human-friendly name — used for substring matching and display. */
  name: string;
  /** Backend identifier passed to ffmpeg's `-i` (avfoundation name or pulse source name). */
  id: string;
}

/**
 * Parse the device list from ffmpeg's avfoundation `-list_devices` stderr (macOS).
 * Exported for testing; the audio section looks like:
 *
 *   [AVFoundation indev @ 0x..] AVFoundation audio devices:
 *   [AVFoundation indev @ 0x..] [0] MacBook Pro Microphone
 */
export function parseAvfoundationDevices(stderr: string): AudioInputDevice[] {
  const devices: AudioInputDevice[] = [];
  let inAudioSection = false;
  for (const line of stderr.split("\n")) {
    if (line.includes("AVFoundation audio devices:")) {
      inAudioSection = true;
      continue;
    }
    if (line.includes("AVFoundation video devices:")) {
      inAudioSection = false;
      continue;
    }
    if (!inAudioSection) continue;
    const match = line.match(/\[(\d+)\]\s+(.+?)\s*$/);
    // avfoundation is addressed by name (or index); name doubles as the id.
    if (match) devices.push({ index: Number(match[1]), name: match[2], id: match[2] });
  }
  return devices;
}

/**
 * Parse `pactl list sources` stdout (Linux / PipeWire's PulseAudio compat).
 * Exported for testing; each source is a block like:
 *
 *   Source #64
 *   	Name: alsa_input.usb-Generic_USB_Audio-00.HiFi__Line__source
 *   	Description: USB Audio Line Input
 *
 * `Name` is the stable id ffmpeg's pulse demuxer wants; `Description` is the
 * friendly label. Monitor sources (loopbacks of outputs) are skipped — they are
 * not real inputs.
 */
export function parsePactlSources(stdout: string): AudioInputDevice[] {
  const devices: AudioInputDevice[] = [];
  let index = -1;
  let name = "";
  let description = "";
  const flush = () => {
    if (index >= 0 && name && !name.endsWith(".monitor")) {
      devices.push({ index, name: description || name, id: name });
    }
    index = -1;
    name = "";
    description = "";
  };
  for (const line of stdout.split("\n")) {
    const head = line.match(/^Source #(\d+)/);
    if (head) {
      flush();
      index = Number(head[1]);
      continue;
    }
    const nm = line.match(/^\s*Name:\s*(.+?)\s*$/);
    if (nm) {
      name = nm[1];
      continue;
    }
    const dm = line.match(/^\s*Description:\s*(.+?)\s*$/);
    if (dm) {
      description = dm[1];
    }
  }
  flush();
  return devices;
}

/** Enumerate Core Audio input devices via ffmpeg's avfoundation backend (macOS). */
function listAvfoundationDevices(ffmpeg: string): AudioInputDevice[] {
  const proc = Bun.spawnSync(
    [ffmpeg, "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
    { stdout: "ignore", stderr: "pipe" },
  );
  // ffmpeg exits non-zero after listing (no real input opened) — that's expected.
  return parseAvfoundationDevices(proc.stderr.toString());
}

/** Enumerate PulseAudio/PipeWire input sources via `pactl` (Linux). */
function listPulseDevices(): AudioInputDevice[] {
  const proc = Bun.spawnSync(["pactl", "list", "sources"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  return parsePactlSources(proc.stdout.toString());
}

/** Enumerate audio input devices using the platform's native backend. */
export function listInputDevices(ffmpeg = "ffmpeg"): AudioInputDevice[] {
  return process.platform === "darwin"
    ? listAvfoundationDevices(ffmpeg)
    : listPulseDevices();
}

/**
 * The ffmpeg input arguments (format + source) for a device, per platform. The
 * `platform` arg is injectable so both branches stay unit-testable on any host.
 */
export function ffmpegInputArgs(
  device: AudioInputDevice,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "darwin") return ["-f", "avfoundation", "-i", `:${device.id}`];
  // PipeWire ships a PulseAudio-compatible server; the pulse demuxer takes the
  // source Name directly.
  return ["-f", "pulse", "-i", device.id];
}

/** First device whose name or id contains `substring` (case-insensitive). */
export function resolveDevice(
  substring: string,
  devices: AudioInputDevice[],
): AudioInputDevice | undefined {
  const needle = substring.toLowerCase();
  return devices.find(
    (d) => d.name.toLowerCase().includes(needle) || d.id.toLowerCase().includes(needle),
  );
}
