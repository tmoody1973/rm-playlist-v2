import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  findHost,
  matchBiography,
  pageImageUrl,
  parseBiographies,
  parseBylinedStories,
  personSlug,
  publicProfiles,
  showArt,
  showSlugFor,
} from "../convex/hostProfilesLogic";
import biographies from "./fixtures/cds-biographies.json";
import bylineStories from "./fixtures/cds-byline-stories.json";

const fixtureHtml = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("parseBiographies (real s921 CDS biography list)", () => {
  test("keeps id and title of biography documents", () => {
    const bios = parseBiographies(biographies);
    expect(bios).toContainEqual({ id: "1179410589", title: "Erin Wolf" });
    expect(bios).toContainEqual({ id: "1167538791", title: "Mallorey Wallace" });
    expect(bios.length).toBe(biographies.resources.length);
  });

  test("garbage is an empty list, not a crash", () => {
    expect(parseBiographies(null)).toEqual([]);
    expect(parseBiographies({ resources: [{ title: "no id" }] })).toEqual([]);
  });
});

describe("matchBiography", () => {
  const bios = parseBiographies(biographies);

  test("exact name match, ignoring case and spacing", () => {
    expect(matchBiography("  erin   WOLF ", bios)).toEqual({
      id: "1179410589",
      title: "Erin Wolf",
      method: "exact",
    });
  });

  test("Cadence's 'Mallory' finds the site's 'Mallorey' as a fuzzy match", () => {
    expect(matchBiography("Mallory Wallace", bios)).toEqual({
      id: "1167538791",
      title: "Mallorey Wallace",
      method: "fuzzy",
    });
  });

  test("a different surname never matches, even one letter off in the first name", () => {
    expect(matchBiography("Erin Wolfe", bios)).toBeNull();
    expect(matchBiography("Jon Adler", bios)).toBeNull();
  });

  test("a bare first name is not enough to match a biography", () => {
    expect(matchBiography("Erin", bios)).toBeNull();
  });
});

describe("parseBylinedStories (real stories bylined to Erin Wolf)", () => {
  test("title, canonical url and publish time, newest first as CDS sorted them", () => {
    const stories = parseBylinedStories(bylineStories, 5);
    expect(stories[0]).toEqual({
      cdsId: "g-s921-16853",
      title: "The top albums from New Music Friday for Oct. 2",
      url: "https://radiomilwaukee.org/new-music/2026-10-02/new-music-friday-oct-2-best-albums",
      publishedAt: Date.parse("2026-10-02T05:30:00-05:00"),
    });
    expect(stories.map((s) => s.cdsId)).toEqual(["g-s921-16853", "g-s921-16494", "g-s921-16430"]);
  });

  test("caps at the limit", () => {
    expect(parseBylinedStories(bylineStories, 2)).toHaveLength(2);
  });

  test("decodes HTML entities in titles and skips stories without a canonical page", () => {
    const stories = parseBylinedStories(
      {
        resources: [
          {
            id: "a",
            title: "Erick Sermon &amp; Muluken Mellesse &#8217;24",
            publishDateTime: "2026-09-01T10:00:00-05:00",
            webPages: [{ href: "https://radiomilwaukee.org/a", rels: ["canonical"] }],
          },
          { id: "b", title: "No page", publishDateTime: "2026-09-01T10:00:00-05:00" },
        ],
      },
      5,
    );
    expect(stories).toEqual([
      {
        cdsId: "a",
        title: "Erick Sermon & Muluken Mellesse ’24",
        url: "https://radiomilwaukee.org/a",
        publishedAt: Date.parse("2026-09-01T10:00:00-05:00"),
      },
    ]);
  });
});

describe("pageImageUrl (real radiomilwaukee.org pages)", () => {
  test("a person page gives the 3:4 portrait jpeg, not webp and not the wide share crop", () => {
    expect(pageImageUrl(fixtureHtml("rm-people-erin-wolf.html"))).toBe(
      "https://npr.brightspotcdn.com/dims4/default/89126a1/2147483647/strip/true/crop/1280x1707+417+0/resize/300x400!/quality/90/?url=http%3A%2F%2Fnpr-brightspot.s3.amazonaws.com%2Flegacy%2Fwp-content%2Fuploads%2F2022%2F07%2F08095305%2FErin-Wolf-scaled.jpg",
    );
  });

  test("a show page gives the larger square rendition", () => {
    expect(pageImageUrl(fixtureHtml("rm-show-rhythm-lab.html"))).toContain(
      "/resize/560x560!/quality/",
    );
  });

  test("with no square-ish rendition, falls back to the page's og:image", () => {
    expect(pageImageUrl(fixtureHtml("rm-show-in-the-mix.html"))).toContain("/resize/1200x630!/");
  });

  test("a page with no og:image has no image", () => {
    expect(pageImageUrl("<html><img src='https://npr.brightspotcdn.com/x.jpg'></html>")).toBeNull();
  });
});

describe("personSlug", () => {
  test("matches radiomilwaukee.org /people slugs", () => {
    expect(personSlug("Erin Wolf")).toBe("erin-wolf");
    expect(personSlug("Element Everest-Blanks")).toBe("element-everest-blanks");
    expect(personSlug("Mallorey Wallace")).toBe("mallorey-wallace");
  });
});

describe("showSlugFor", () => {
  test("Cadence program names map to their /show page", () => {
    expect(showSlugFor("What's All This: Adventures in New Music")).toBe("whats-all-this");
    expect(showSlugFor("Rhythm Lab Radio")).toBe("rhythm-lab");
    expect(showSlugFor("Rhythm Lab with Tarik Moody")).toBe("rhythm-lab");
    expect(showSlugFor("Kids' Disco")).toBe("kids-disco");
    expect(showSlugFor("Let's Hear It")).toBe("lets-hear-it");
  });

  test("dayparts and syndicated shows have no show page", () => {
    expect(showSlugFor("88Nine Midday Show")).toBeNull();
    expect(showSlugFor("Sound Opinions")).toBeNull();
  });
});

describe("findHost", () => {
  const hosts = [{ name: "Erin Wolf" }, { name: "Mallory Wallace" }, { name: "Kenny Perez" }];

  test("exact, then fuzzy on spelling", () => {
    expect(findHost(hosts, "erin wolf")?.name).toBe("Erin Wolf");
    expect(findHost(hosts, "Mallorey Wallace")?.name).toBe("Mallory Wallace");
  });

  test("unknown name is null", () => {
    expect(findHost(hosts, "Taylor Swift")).toBeNull();
  });
});

describe("publicProfiles", () => {
  const stored = [
    {
      name: "Mallory Wallace",
      cdsId: "1167538791",
      matchMethod: "fuzzy" as const,
      imageUrl: "https://img/mw.jpg",
      profileUrl: "https://radiomilwaukee.org/people/mallorey-wallace",
      latest: [{ cdsId: "x", title: "T", url: "https://u", publishedAt: 1 }],
    },
  ];

  test("one entry per host, in order; hosts without a profile get nulls", () => {
    expect(publicProfiles(["Mallory Wallace", "Jon Adler"], stored)).toEqual([
      {
        name: "Mallory Wallace",
        imageUrl: "https://img/mw.jpg",
        profileUrl: "https://radiomilwaukee.org/people/mallorey-wallace",
        latest: [{ title: "T", url: "https://u", publishedAt: 1 }],
      },
      { name: "Jon Adler", imageUrl: null, profileUrl: null, latest: [] },
    ]);
  });
});

describe("showArt", () => {
  const shows = [
    {
      slug: "rhythm-lab",
      url: "https://radiomilwaukee.org/show/rhythm-lab",
      imageUrl: "https://img/rl.jpg",
    },
  ];

  test("a program with a show page gets its art and link", () => {
    expect(showArt("Rhythm Lab Radio", shows)).toEqual({
      imageUrl: "https://img/rl.jpg",
      link: "https://radiomilwaukee.org/show/rhythm-lab",
    });
  });

  test("anything else is null, never a guess", () => {
    expect(showArt("88Nine Midday Show", shows)).toEqual({ imageUrl: null, link: null });
    expect(showArt("Ladies First", shows)).toEqual({ imageUrl: null, link: null });
  });
});
