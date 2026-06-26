export interface AudioInputDevice {
  index: number;
  name: string;
}

/**
 * Parse the device list from ffmpeg's avfoundation `-list_devices` stderr.
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
    if (match) devices.push({ index: Number(match[1]), name: match[2] });
  }
  return devices;
}

/** Enumerate Core Audio input devices via ffmpeg's avfoundation backend. */
export function listInputDevices(ffmpeg = "ffmpeg"): AudioInputDevice[] {
  const proc = Bun.spawnSync(
    [ffmpeg, "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
    { stdout: "ignore", stderr: "pipe" },
  );
  // ffmpeg exits non-zero after listing (no real input opened) — that's expected.
  return parseAvfoundationDevices(proc.stderr.toString());
}

/** First device whose name contains `substring` (case-insensitive). */
export function resolveDevice(
  substring: string,
  devices: AudioInputDevice[],
): AudioInputDevice | undefined {
  const needle = substring.toLowerCase();
  return devices.find((d) => d.name.toLowerCase().includes(needle));
}
