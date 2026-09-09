import { h } from "preact";
import type { PublicPlay } from "../types";
import { AlbumArt } from "./AlbumArt";
import { PreviewButton } from "./PreviewButton";
import { formatPlayedAtClock } from "../format";

interface ListItemProps {
  readonly play: PublicPlay;
  readonly enablePreview: boolean;
}

/**
 * One row in the `playlist` widget's `list` layout.
 *
 * Wide: thumb, then title + artist, then time + preview button on one line.
 * Narrow: the time and button drop below the song, so the title and artist
 * get the full width beside the artwork. That split is specified in
 * docs/design/003-responsive-accessibility.md section B ("Mobile: Stacked:
 * art + (track / artist / time)").
 *
 * Why the layout styles are classes here when the rest of the widget is
 * inline-styled: the narrow branch is a container query, and a container
 * query cannot be expressed as an inline style. An inline style would also
 * out-specify the stylesheet rule, so a half-and-half version silently
 * keeps the wide layout at every width. The rules live in `tokens.css`,
 * which the variant entrypoints already inject into the shadow root, so
 * this adds no new delivery mechanism.
 *
 * Before this split, a row on a 350px-wide widget gave the title 91px,
 * about three characters, once a preview button was present. Rows without
 * a button looked fine, which is what made it read as a data problem
 * rather than a layout one.
 */
export function ListItem({ play, enablePreview }: ListItemProps) {
  return (
    <li class="rmke-row">
      <AlbumArt src={play.artworkUrl} alt={`${play.title} — ${play.artist}`} size={56} />

      <div class="rmke-row-body">
        <div class="rmke-row-text">
          <span class="rmke-row-title">{play.title}</span>
          <span class="rmke-row-artist">{play.artist}</span>
        </div>

        <div class="rmke-row-meta">
          <time class="rmke-row-time" dateTime={new Date(play.playedAt).toISOString()}>
            {formatPlayedAtClock(play.playedAt)}
          </time>
          {enablePreview && (
            <PreviewButton
              appleMusicSongId={play.appleMusicSongId}
              previewUrl={play.previewUrl}
              trackLabel={`${play.title} by ${play.artist}`}
            />
          )}
        </div>
      </div>
    </li>
  );
}
