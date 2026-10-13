// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/**
 * Copy for the top of the page: Opera announcing HTML-in-Canvas in its latest browser, and the photo stories of the
 * news section. Everything here is made up for the demo (people quoted in the developer quotes are fictional).
 */

export const HERO = {
  badge: 'New · Available now in the latest Opera',
  title: ['HTML in Canvas', 'is here.'],
  lede:
    'Draw real, live HTML straight into a canvas. The latest Opera renders your DOM — text, forms, images and video — ' +
    'into 2D, WebGL and WebGPU canvases with one call to drawElementImage, while every element stays accessible, ' +
    'selectable and interactive. No screenshots, no re-implemented text layout, no compromises.',
  stats: [
    ['1', 'function call to put a whole page on the GPU'],
    ['0', 'screenshots, hacks or hidden iframes'],
    ['100%', 'real DOM: find-in-page, screen readers and forms keep working'],
  ] as [string, string][],
};

export const NAV_LINKS = ['Browsers', 'Opera GX', 'Opera Air', 'Developers', 'Features', 'Blog', 'Help'];

export const FEATURES: { icon: string; title: string; text: string }[] = [
  {
    icon: 'live',
    title: 'Live DOM, real pixels',
    text: 'drawElementImage paints an element and its whole subtree into a 2D canvas at full device resolution. Change the DOM and the canvas follows on the next paint.',
  },
  {
    icon: 'gpu',
    title: 'Straight to the GPU',
    text: 'copyElementImageToTexture and texElementImage2D upload HTML directly into WebGPU and WebGL textures. Wrap a form around a 3D model, or drive a bulldozer through a newspaper.',
  },
  {
    icon: 'a11y',
    title: 'Accessible by default',
    text: 'Canvas children stay in the accessibility tree. Screen readers, keyboard focus, find-in-page and translation work on the real elements, not on a picture of them.',
  },
  {
    icon: 'hand',
    title: 'Interactive',
    text: 'Hit testing maps pointer events back to the elements you drew, so buttons click, inputs take focus and text selects, even when the canvas is skewed or wrapped onto a sphere.',
  },
  {
    icon: 'bolt',
    title: 'Paint events',
    text: 'The new paint event lists exactly which canvas children changed, so you redraw only what moved. requestPaint() schedules an update when you need one right now.',
  },
  {
    icon: 'lock',
    title: 'Private by design',
    text: 'Cross-origin images, visited links and system colours are never exposed to script. What you can draw is exactly what your page could already read.',
  },
];

export const QUOTES: { text: string; name: string; role: string }[] = [
  {
    text: 'We deleted four thousand lines of homemade text layout and replaced them with one function call. Our 3D editor finally has real text, real kerning and real right-to-left support.',
    name: 'Mira Castellanos',
    role: 'Graphics engineer, Pinecone Interactive',
  },
  {
    text: 'Forms inside a WebGPU scene that a screen reader can still read used to be a research project. Now it is a Tuesday afternoon.',
    name: 'Jonah Okafor',
    role: 'Accessibility lead, Brightline Labs',
  },
  {
    text: 'I built a game where you bulldoze a news site. Every single word you push around is a real word from the DOM. My kids think I made the internet physical.',
    name: 'Ida Lindqvist',
    role: 'Creative coder',
  },
];

export const RELEASE_NOTES: string[] = [
  'CanvasRenderingContext2D.drawElementImage() draws a canvas child with its whole subtree.',
  'GPUQueue.copyElementImageToTexture() copies an element straight into a WebGPU texture.',
  'WebGL texElementImage2D() and texElementSubImage2D() upload HTML into WebGL textures.',
  'The layoutsubtree attribute lays out and hit-tests canvas children without showing them.',
  'The paint event and changedElements tell you which children need a redraw.',
  'canvas.requestPaint() asks for a paint event on the next frame.',
  'DevTools highlights drawn canvas children and shows their paint timings.',
  'Up to 40% less memory than rasterising the same content through an offscreen canvas.',
];

export const FAQ: [string, string][] = [
  [
    'Is this just a screenshot?',
    'No. The element is rasterised by the browser’s own paint pipeline every time it changes, at the resolution you ask for, and stays a live element you can type into.',
  ],
  [
    'Does it work with video and animations?',
    'Yes. Videos, CSS animations and transitions all produce paint events, so your canvas can follow them frame by frame.',
  ],
  [
    'What about privacy?',
    'Anything your page could not read before stays hidden: cross-origin images, visited-link styles and system colours are painted as if they were not there.',
  ],
  [
    'Do I need to change my markup?',
    'Put the elements inside a canvas with the layoutsubtree attribute, then draw them. Everything else is ordinary HTML and CSS.',
  ],
  [
    'Where can I learn more?',
    'The developer guide has examples for 2D, WebGL and WebGPU, plus a playground you can open right from this page.',
  ],
];

export const CODE_SAMPLE = [
  '// Render live HTML into a canvas',
  'const canvas = document.querySelector("canvas");',
  'const ctx = canvas.getContext("2d");',
  'const card = canvas.querySelector(".card");',
  '',
  'canvas.onpaint = (e) => {',
  '  ctx.reset();',
  '  ctx.drawElementImage(card, 40, 40);',
  '};',
  'canvas.requestPaint();',
  '',
  '// Or upload straight into WebGPU',
  'device.queue.copyElementImageToTexture(',
  '  { source: card },',
  '  { destination: { texture } });',
];

/** One of the news section's feature stories built around a photo. */
export interface PhotoStory {
  key: string;
  section: string;
  title: string;
  byline: string;
  /** Without a photo the story is text only. */
  img?: { src: string; w: number; h: number; alt: string };
  caption?: string;
  paragraphs: string[];
}

export const PHOTO_STORIES: PhotoStory[] = [
  {
    key: 'opera30',
    section: 'Opera at 30',
    title: 'Thirty Years of Opera: A Birthday Party With a Pixel Cake',
    byline: 'By the Daily Scroll events desk',
    paragraphs: [
      'Three decades of building browsers deserved a proper party, and Opera delivered one. Under a giant glowing screen covered in pixel-art icons and a slice of eight-bit birthday cake, colleagues past and present gathered for an evening of stories, speeches and a remarkable amount of cheering.',
      'Guests swapped memories from the earliest builds, when a browser fit on a floppy disk and a fast connection meant you could make tea while a page loaded, and compared them with what the teams are shipping today. The big screen cycled through icons for tabs, privacy, speed and sync, each one met with applause from the people who had built it.',
      '"Thirty years is a long time in browser years. That is roughly four hundred in dog years and about nine thousand in JavaScript frameworks," said one of the developers who works on new web platform features at Opera. "The best part was seeing people who built the browser before tabs were even a thing, standing on the same stage as the people building what comes next."',
      'Asked what comes next, the developer pointed at the page you are reading. "HTML in Canvas. Every word on this page is real HTML, drawn into a canvas on the GPU. Go on, drive into it. Nobody will mind."',
      'The celebration ran late into the evening. Organisers report that the pixel cake on the screen survived intact, while the real one did not survive the first ten minutes.',
    ],
  },
  {
    key: 'tram',
    section: 'City',
    title: 'The Number 3 Heritage Tram Rattles Back for Another Summer of Sundays',
    byline: 'By Oskar Halvorsen',
    img: {
      src: 'tram.jpg',
      w: 1200,
      h: 900,
      alt: 'A green and cream historic tram with the number 3 sign on a tree-lined street on a sunny day',
    },
    caption: 'The museum tram on its Sunday run, bell polished and destination sign freshly rolled.',
    paragraphs: [
      'There is no app for the Sunday tram. There is a timetable taped inside the shelter, a bell you can hear two streets away and a conductor who will tell you the history of every rivet if you let him. After a winter in the depot the green-and-cream heritage car is back on the rails, and the queue at the first stop started before the coffee was ready.',
      '"People ask why we bother, when the modern trams are faster," says Sture Lindqvist, one of the volunteers who spent the winter sanding, varnishing and arguing about the exact shade of green. "Faster is not the point. On this one you open the window, you hear the wheels on the joints and you notice the city you usually scroll past."',
      'The volunteers keep a logbook of every repair, written by hand in a binder older than most of them. The newest entry, in neat pencil: "Bell re-tuned. Again. Children approve."',
      'The tram runs every Sunday until the leaves turn. Tickets are paper, change is counted by hand, and the conductor asks only that you hold on round the corner by the citadel, where the old rails squeal like they have something to say.',
    ],
  },
  {
    key: 'duck',
    section: 'Campus',
    title: 'Meet Ankan, the Rubber Duck Who Has Debugged More Code Than Most Students',
    byline: 'By Freja Nordqvist',
    img: {
      src: 'duck.jpg',
      w: 900,
      h: 1200,
      alt: 'A yellow rubber duck on a wooden desk by a window',
    },
    caption: 'Ankan at his post by the window, waiting for someone to explain their code.',
    paragraphs: [
      'Every programmer knows the trick: explain your code, line by line, to a rubber duck, and the bug reveals itself somewhere around line twelve. At the computer science building one duck has taken the job further than most. Ankan sits on a desk by the window of the second-floor study room, and according to the students, he has a better attendance record than some lecturers.',
      'Nobody remembers who brought him. Some say a teaching assistant left him behind after a late lab; others insist he was simply there one morning, facing the whiteboard as if he had been waiting. "He does the listening and we do the typing," says second-year student Maja Holm. "It is a very fair split. He has never once said my code was wrong. He just looks at you until you notice."',
      'Before deadlines there is a queue. Students explain their assignments to Ankan in a whisper, nod, fix the bug and leave without a word. He takes no credit and accepts payment only in well-indented code.',
    ],
  },
  {
    key: 'buns',
    section: 'Food',
    title: 'Bun of the Week: Cardamom Knots Worth Getting Up Early For',
    byline: 'By our bakery desk',
    img: {
      src: 'buns.jpg',
      w: 1200,
      h: 826,
      alt: 'A wooden bowl of freshly baked cardamom buns with pearl sugar on a red and white checked cloth',
    },
    caption: 'Still warm, and not for long. The verdict: excellent.',
    paragraphs: [
      'Our critics arrived at the little bakery at seven, when the windows were still fogged and the first tray was cooling on the counter. The cardamom knots came in a wooden bowl on a checked cloth: glossy, twisted tight and crunchy with pearl sugar on top. The smell alone earned a point before anyone took a bite.',
      'Inside they were soft and generously spiced, with real crushed cardamom rather than the shy dusting some bakeries get away with. The butter shows up in the layers and does not apologise. One critic tested several for consistency and then several more, purely for accuracy.',
      'Verdict: five knots out of five for the buns, four and a half for the coffee, and a special mention for the baker, who refilled the bowl twice without being asked. Arrive early. By nine there is nothing left but crumbs and a hand-written sign that says "Tomorrow".',
    ],
  },
  {
    key: 'steven',
    section: 'Pets',
    title: 'Kitchen Veteran Steven Awarded Gold Medal for Services Nobody Can Quite Remember',
    byline: 'By Margit Ekdahl',
    img: {
      src: 'steven.jpg',
      w: 900,
      h: 1200,
      alt: 'A tabby-and-white cat with white paws standing on a kitchen floor, wearing a gold medal on a green-and-yellow ribbon',
    },
    caption:
      'Steven, decorated veteran of the family kitchen, poses with his medal and gazes into the middle distance.',
    paragraphs: [
      'The family kitchen held a small but dignified ceremony this week as Steven, a tabby-and-white cat with four immaculate white paws, was awarded a gold medal on a green-and-yellow striped ribbon. The citation praises "years of devoted service on the kitchen floor," and stops there, because nobody can agree on what exactly the service was.',
      'Theories in the household range from heroically guarding the fridge door every time it opens to personally inspecting every dropped crumb since 2019. One family member insists Steven once saw off a suspicious moth. The moth has not come forward to confirm this, and there are no other witnesses.',
      'Steven accepted the honour standing perfectly still, chest out, gazing nobly at something just off to one side. Asked how it felt to be decorated, he declined to comment, then sat on the newspaper we were writing on. The medal is expected to stay on for the rest of the afternoon or until the next nap, whichever comes first.',
    ],
  },
];
