import { describe, expect, test } from "bun:test";
import {
  airtimeFromEpisode,
  buildSchedulePrograms,
  findProgram,
  hostsFromName,
  programHosts,
  scheduleAt,
  weekDateRange,
  type ScheduleProgram,
} from "../convex/scheduleLogic";

const SAT = 6;
const SUN = 0;
const FRI = 5;
const WEEKDAYS = [1, 2, 3, 4, 5];

function program(
  name: string,
  hosts: string[],
  airtimes: ScheduleProgram["airtimes"],
): ScheduleProgram {
  return { programId: name.toLowerCase().replace(/\W+/g, "-"), name, hosts, airtimes };
}

const at = (dayOfWeek: number, startMin: number, endMin: number) => ({
  dayOfWeek,
  startMin,
  endMin,
});

// A slice of the real 88Nine week (Cadence, 2026-10-05).
const PROGRAMS: ScheduleProgram[] = [
  program(
    "88Nine Early Mornings",
    [],
    [0, 1, 2, 3, 4, 5, 6].map((d) => at(d, 0, 360)),
  ),
  program(
    "88Nine Midday Show",
    ["Erin Wolf"],
    WEEKDAYS.map((d) => at(d, 600, 840)),
  ),
  program("What's All This: Adventures in New Music", ["Erin Wolf"], [at(1, 1320, 1380)]),
  program("Rhythm Lab Radio", ["Tarik Moody"], [at(FRI, 1320, 1440)]),
  program("Rhythm Lab with Tarik Moody", ["Tarik Moody"], []),
  program("Audio Taste Test", ["Britt Gottschalk"], [at(4, 1320, 1380)]),
  program("Kids' Disco", ["Dori Zori"], [at(SAT, 540, 600)]),
  program("In the Mix", ["Kenny Perez"], [at(SAT, 1260, 1440)]),
  program(
    "88Nine Weekends with Mallory Wallace",
    ["Mallory Wallace"],
    [at(SAT, 360, 540), at(SUN, 360, 540)],
  ),
];

describe("hostsFromName", () => {
  test("takes the name after a trailing 'with'", () => {
    expect(hostsFromName("88Nine Weekends with Britt Gottschalk")).toEqual(["Britt Gottschalk"]);
    expect(hostsFromName("Rhythm Lab with Tarik Moody")).toEqual(["Tarik Moody"]);
  });

  test("no 'with' suffix means no hosts", () => {
    expect(hostsFromName("88Nine Morning Show")).toEqual([]);
    expect(hostsFromName("Sound Opinions")).toEqual([]);
  });
});

describe("programHosts", () => {
  test("Cadence hosts win over the name", () => {
    expect(
      programHosts({ programName: "La Alternativa", hosts: ["Kenny Perez", "Paula Lovo"] }),
    ).toEqual(["Kenny Perez", "Paula Lovo"]);
  });

  test("empty Cadence hosts fall back to the 'with <Name>' suffix", () => {
    expect(programHosts({ programName: "88Nine Weekends with Kat Froehlich", hosts: [] })).toEqual([
      "Kat Froehlich",
    ]);
  });

  test("displayHost false hides hosts, even ones Cadence or the name would give", () => {
    expect(
      programHosts({
        programName: "88Nine Weekends with Kat Froehlich",
        hosts: ["Kat Froehlich"],
        displayHost: false,
      }),
    ).toEqual([]);
  });
});

describe("airtimeFromEpisode", () => {
  test("reads day and minutes from Cadence's channel-local times", () => {
    expect(airtimeFromEpisode("2026-10-05T10:00:00-05:00", "2026-10-05T14:00:00-05:00")).toEqual(
      at(1, 600, 840),
    );
  });

  test("an episode ending at midnight ends at minute 1440", () => {
    expect(airtimeFromEpisode("2026-10-09T22:00:00-05:00", "2026-10-10T00:00:00-05:00")).toEqual(
      at(FRI, 1320, 1440),
    );
  });

  test("an episode crossing midnight keeps running past 1440", () => {
    expect(airtimeFromEpisode("2026-10-10T23:00:00-05:00", "2026-10-11T02:00:00-05:00")).toEqual(
      at(SAT, 1380, 1560),
    );
  });

  test("garbage in is null, not a crash", () => {
    expect(airtimeFromEpisode("nope", "2026-10-11T02:00:00-05:00")).toBeNull();
  });
});

describe("weekDateRange", () => {
  test("today through six days on, in Chicago", () => {
    // 2026-10-06T03:00Z is still Monday 10 PM in Milwaukee.
    expect(weekDateRange(Date.parse("2026-10-06T03:00:00Z"))).toBe("2026-10-05,2026-10-11");
  });
});

describe("buildSchedulePrograms", () => {
  const details = [
    {
      programId: "p1",
      programName: "Rhythm Lab Radio",
      hosts: ["Tarik Moody"],
      displayHost: true,
      description: "Global beats",
      link: "https://radiomilwaukee.org/rhythm-lab",
    },
    { programId: "p2", programName: "Sound Opinions", hosts: [], description: "", link: "" },
  ];
  const episodes = [
    {
      programId: "p1",
      start: { local: "2026-10-09T22:00:00-05:00" },
      end: { local: "2026-10-10T00:00:00-05:00" },
    },
    // The same slot seen twice (e.g. a range that wraps) is one airtime.
    {
      programId: "p1",
      start: { local: "2026-10-16T22:00:00-05:00" },
      end: { local: "2026-10-17T00:00:00-05:00" },
    },
    { programId: "unknown", start: { local: "2026-10-09T01:00:00-05:00" }, end: {} },
  ];

  test("joins program details to their weekly airtimes and drops empty strings", () => {
    expect(buildSchedulePrograms(details, episodes)).toEqual([
      {
        programId: "p1",
        name: "Rhythm Lab Radio",
        hosts: ["Tarik Moody"],
        description: "Global beats",
        link: "https://radiomilwaukee.org/rhythm-lab",
        airtimes: [at(FRI, 1320, 1440)],
      },
      { programId: "p2", name: "Sound Opinions", hosts: [], airtimes: [] },
    ]);
  });

  test("skips details without an id or name", () => {
    expect(buildSchedulePrograms([{ programId: "x" }, null], [])).toEqual([]);
  });
});

describe("scheduleAt", () => {
  test("weekday midday: Erin Wolf on now, What's All This next", () => {
    // Monday 2026-10-05 13:00 CDT
    const result = scheduleAt(PROGRAMS, Date.parse("2026-10-05T18:00:00Z"));
    expect(result.onNow).toEqual({
      name: "88Nine Midday Show",
      hosts: ["Erin Wolf"],
      startsAt: Date.parse("2026-10-05T15:00:00Z"),
      endsAt: Date.parse("2026-10-05T19:00:00Z"),
    });
    expect(result.next).toEqual({
      name: "What's All This: Adventures in New Music",
      hosts: ["Erin Wolf"],
      startsAt: Date.parse("2026-10-06T03:00:00Z"),
      endsAt: Date.parse("2026-10-06T04:00:00Z"),
    });
  });

  test("a gap in the schedule has nothing on now but still a next", () => {
    const result = scheduleAt(PROGRAMS, Date.parse("2026-10-05T20:00:00Z"));
    expect(result.onNow).toBeNull();
    expect(result.next?.name).toBe("What's All This: Adventures in New Music");
  });

  test("a show crossing midnight is on now the morning after", () => {
    const late = [program("Overnight", [], [at(SAT, 1380, 1560)])];
    // Sunday 2026-10-11 01:00 CDT
    const result = scheduleAt(late, Date.parse("2026-10-11T06:00:00Z"));
    expect(result.onNow?.name).toBe("Overnight");
    expect(result.onNow?.endsAt).toBe(Date.parse("2026-10-11T07:00:00Z"));
  });

  test("across the Nov 1 2026 fall-back, civil times stay civil", () => {
    // Sat Oct 31 23:30 CDT (UTC-5): In the Mix until midnight CDT.
    const before = scheduleAt(PROGRAMS, Date.parse("2026-11-01T04:30:00Z"));
    expect(before.onNow?.name).toBe("In the Mix");
    expect(before.onNow?.endsAt).toBe(Date.parse("2026-11-01T05:00:00Z"));
    expect(before.next?.name).toBe("88Nine Early Mornings");
    expect(before.next?.startsAt).toBe(Date.parse("2026-11-01T05:00:00Z"));

    // Sun Nov 1 05:30 CST (UTC-6): Early Mornings runs a 7-hour night and ends 06:00 CST.
    const after = scheduleAt(PROGRAMS, Date.parse("2026-11-01T11:30:00Z"));
    expect(after.onNow?.name).toBe("88Nine Early Mornings");
    expect(after.onNow?.endsAt).toBe(Date.parse("2026-11-01T12:00:00Z"));
    expect(after.next).toEqual({
      name: "88Nine Weekends with Mallory Wallace",
      hosts: ["Mallory Wallace"],
      startsAt: Date.parse("2026-11-01T12:00:00Z"),
      endsAt: Date.parse("2026-11-01T15:00:00Z"),
    });
  });

  test("no programs, no answers", () => {
    expect(scheduleAt([], Date.now())).toEqual({ onNow: null, next: null });
  });
});

describe("findProgram", () => {
  // Monday 2026-10-05 13:00 CDT
  const NOW = Date.parse("2026-10-05T18:00:00Z");

  test("matches a show by name and prefers the one that actually airs", () => {
    const match = findProgram(PROGRAMS, "rhythm lab", NOW);
    expect(match?.name).toBe("Rhythm Lab Radio");
    expect(match?.airtimes).toEqual([
      { dayOfWeek: FRI, day: "Friday", startMin: 1320, endMin: 1440, start: "10 PM", end: "12 AM" },
    ]);
    expect(match?.nextAiring).toEqual({
      startsAt: Date.parse("2026-10-10T03:00:00Z"),
      endsAt: Date.parse("2026-10-10T05:00:00Z"),
    });
    expect(match?.lastAired).toEqual({
      startsAt: Date.parse("2026-10-03T03:00:00Z"),
      endsAt: Date.parse("2026-10-03T05:00:00Z"),
    });
    expect(match?.airingNow).toBe(false);
  });

  test("ignores case, punctuation and the station name", () => {
    expect(findProgram(PROGRAMS, "Audio Taste Test", NOW)?.name).toBe("Audio Taste Test");
    expect(findProgram(PROGRAMS, "kids disco", NOW)?.name).toBe("Kids' Disco");
    expect(findProgram(PROGRAMS, "88nine midday", NOW)?.name).toBe("88Nine Midday Show");
  });

  test("matches a host and picks the show on air soonest", () => {
    const match = findProgram(PROGRAMS, "erin wolf", NOW);
    expect(match?.name).toBe("88Nine Midday Show");
    expect(match?.hosts).toEqual(["Erin Wolf"]);
    expect(match?.airingNow).toBe(true);
    expect(match?.lastAired?.startsAt).toBe(Date.parse("2026-10-05T15:00:00Z"));
  });

  test("a show with no airtimes still matches, with no airings", () => {
    const solo = [program("Sound Opinions", [], [])];
    expect(findProgram(solo, "sound opinions", NOW)).toEqual({
      name: "Sound Opinions",
      hosts: [],
      airtimes: [],
      lastAired: null,
      nextAiring: null,
      airingNow: false,
    });
  });

  test("nothing close enough is null", () => {
    expect(findProgram(PROGRAMS, "car talk", NOW)).toBeNull();
    expect(findProgram(PROGRAMS, "  ", NOW)).toBeNull();
  });
});
