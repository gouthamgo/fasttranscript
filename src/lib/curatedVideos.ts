import { VideoCategory } from '../types';

/**
 * Editorial seed list for the discovery feed.
 *
 * These entries carry NO transcript. They are pointers: selecting one navigates
 * to `/?v=<id>` and extracts the real captions, exactly as pasting the link
 * would. The previous version embedded three-to-five hand-written "transcript"
 * lines per video, which meant clicking a card and pasting its URL produced two
 * different transcripts for the same video.
 *
 * Every title, channel and id below was verified against YouTube's oEmbed
 * endpoint. The old list was not: it credited a Michael Seibel talk to Sam
 * Altman, dated the Stanford commencement address to 1997, and pointed at one
 * video that no longer exists.
 */
export interface CuratedVideo {
  id: string;
  title: string;
  channelTitle: string;
  category: VideoCategory;
  blurb: string;
}

export const CURATED_VIDEOS: CuratedVideo[] = [
  {
    id: 'zjkBMFhNj_g',
    title: '[1hr Talk] Intro to Large Language Models',
    channelTitle: 'Andrej Karpathy',
    category: 'AI & Tech',
    blurb: 'The busy person’s introduction to how LLMs are trained and why they behave the way they do.',
  },
  {
    id: 'C27RVio2rOs',
    title: 'Michael Seibel - Building Product',
    channelTitle: 'Y Combinator',
    category: 'YC Talks',
    blurb: 'How to go from an idea to a first version customers actually use.',
  },
  {
    id: 'Th8JoIan4dg',
    title: 'How to Get and Evaluate Startup Ideas | Startup School',
    channelTitle: 'Y Combinator',
    category: 'YC Talks',
    blurb: 'Separating ideas worth pursuing from ideas that merely sound good.',
  },
  {
    id: 'L_Guz73e6fw',
    title: 'Sam Altman: OpenAI CEO on GPT-4, ChatGPT, and the Future of AI',
    channelTitle: 'Lex Fridman',
    category: 'Podcasts',
    blurb: 'A long-form conversation on model capability, safety, and what comes next.',
  },
  {
    id: '5t1vTLU7s40',
    title: 'Yann Lecun: Meta AI, Open Source, Limits of LLMs, AGI & the Future of AI',
    channelTitle: 'Lex Fridman',
    category: 'Podcasts',
    blurb: 'The case against language models as a complete path to intelligence.',
  },
  {
    id: 'Nb2tebYAaOA',
    title: "Jim Keller: Moore's Law, Microprocessors, and First Principles",
    channelTitle: 'Lex Fridman',
    category: 'Podcasts',
    blurb: 'Chip design from first principles, from the architect behind several generations of them.',
  },
  {
    id: 'UF8uR6Z6KLc',
    title: "Steve Jobs' 2005 Stanford Commencement Address",
    channelTitle: 'Stanford',
    category: 'Founders',
    blurb: 'Three stories about connecting the dots, loss, and death.',
  },
  {
    id: 'rFZrL1RiuVI',
    title: 'Peter Thiel: Going from Zero to One',
    channelTitle: 'Chicago Ideas',
    category: 'Founders',
    blurb: 'Why building something new beats competing on something that exists.',
  },
];

/** YouTube's own still for a video — never a stock photo standing in for one. */
export function thumbnailFor(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** Only categories that actually have entries, so no filter can render an empty feed. */
export function availableCategories(): VideoCategory[] {
  const seen = new Set<VideoCategory>();
  for (const video of CURATED_VIDEOS) seen.add(video.category);
  return Array.from(seen);
}
