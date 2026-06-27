import { describe, expect, it } from "bun:test";
import {
  type AudioInputDevice,
  ffmpegInputArgs,
  parseAvfoundationDevices,
  parsePactlSources,
  resolveDevice,
} from "./devices.js";

describe("parseAvfoundationDevices", () => {
  it("parses the audio section and uses the name as id", () => {
    const stderr = [
      "[AVFoundation indev @ 0x1] AVFoundation video devices:",
      "[AVFoundation indev @ 0x1] [0] FaceTime HD Camera",
      "[AVFoundation indev @ 0x1] AVFoundation audio devices:",
      "[AVFoundation indev @ 0x1] [0] MacBook Pro Microphone",
      "[AVFoundation indev @ 0x1] [1] CUBILUX HLMS-C4 Line IN",
    ].join("\n");
    expect(parseAvfoundationDevices(stderr)).toEqual([
      { index: 0, name: "MacBook Pro Microphone", id: "MacBook Pro Microphone" },
      {
        index: 1,
        name: "CUBILUX HLMS-C4 Line IN",
        id: "CUBILUX HLMS-C4 Line IN",
      },
    ]);
  });

  it("ignores video devices", () => {
    const stderr = ["AVFoundation video devices:", "[0] FaceTime HD Camera"].join("\n");
    expect(parseAvfoundationDevices(stderr)).toEqual([]);
  });
});

describe("parsePactlSources", () => {
  const sample = [
    "Source #62",
    "\tName: alsa_output.usb-Generic_USB_Audio-00.HiFi__Speaker__sink.monitor",
    "\tDescription: Monitor of Speaker",
    "Source #64",
    "\tName: alsa_input.usb-CUBILUX_HLMS-C4-00.analog-stereo",
    "\tDescription: CUBILUX HLMS-C4 Analog Stereo",
    "\tState: SUSPENDED",
    "Source #65",
    "\tName: alsa_input.pci-0000_0c_00.analog-stereo",
    "\tDescription: Built-in Audio",
  ].join("\n");

  it("uses Description as name and Name as id, skipping monitors", () => {
    expect(parsePactlSources(sample)).toEqual([
      {
        index: 64,
        name: "CUBILUX HLMS-C4 Analog Stereo",
        id: "alsa_input.usb-CUBILUX_HLMS-C4-00.analog-stereo",
      },
      {
        index: 65,
        name: "Built-in Audio",
        id: "alsa_input.pci-0000_0c_00.analog-stereo",
      },
    ]);
  });

  it("falls back to Name when a source has no Description", () => {
    const stdout = ["Source #1", "\tName: some_source"].join("\n");
    expect(parsePactlSources(stdout)).toEqual([
      { index: 1, name: "some_source", id: "some_source" },
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(parsePactlSources("")).toEqual([]);
  });
});

describe("resolveDevice", () => {
  const devices: AudioInputDevice[] = [
    { index: 0, name: "Built-in Audio", id: "alsa_input.pci.analog-stereo" },
    {
      index: 1,
      name: "CUBILUX HLMS-C4 Analog Stereo",
      id: "alsa_input.usb-CUBILUX_HLMS-C4-00.analog-stereo",
    },
  ];

  it("matches against the friendly name (case-insensitive)", () => {
    expect(resolveDevice("cubilux", devices)?.index).toBe(1);
  });

  it("matches against the backend id when the name differs", () => {
    // A config substring that only appears in the pulse source Name still resolves.
    expect(resolveDevice("usb-CUBILUX_HLMS-C4", devices)?.index).toBe(1);
  });

  it("returns undefined when nothing matches", () => {
    expect(resolveDevice("nonexistent", devices)).toBeUndefined();
  });
});

describe("ffmpegInputArgs", () => {
  const device: AudioInputDevice = {
    index: 1,
    name: "CUBILUX HLMS-C4 Analog Stereo",
    id: "alsa_input.usb-CUBILUX.analog-stereo",
  };

  it("uses avfoundation with a leading colon on macOS", () => {
    expect(ffmpegInputArgs(device, "darwin")).toEqual([
      "-f",
      "avfoundation",
      "-i",
      ":alsa_input.usb-CUBILUX.analog-stereo",
    ]);
  });

  it("uses the pulse demuxer with the source name on Linux", () => {
    expect(ffmpegInputArgs(device, "linux")).toEqual([
      "-f",
      "pulse",
      "-i",
      "alsa_input.usb-CUBILUX.analog-stereo",
    ]);
  });
});
