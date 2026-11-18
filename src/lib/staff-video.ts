// Made by scripts/make-staff-video.ts: do not edit by hand.

/** The staff video guide, its length and where each chapter starts (seconds). */
export const STAFF_VIDEO = {
  src: '/guide/xtend-staff-guide.mp4',
  poster: '/guide/xtend-staff-guide.jpg',
  seconds: 338,
  chapters: [
    {
      "title": "Get the app",
      "at": 9.6
    },
    {
      "title": "Sign in",
      "at": 42
    },
    {
      "title": "Allow location, camera and notifications",
      "at": 62.1
    },
    {
      "title": "Finish setting up: location and battery",
      "at": 98.2
    },
    {
      "title": "Your photo",
      "at": 160.4
    },
    {
      "title": "Clock in",
      "at": 170.9
    },
    {
      "title": "Store visits (marketers)",
      "at": 204.3
    },
    {
      "title": "Daily report",
      "at": 228.2
    },
    {
      "title": "Clock out",
      "at": 246.7
    },
    {
      "title": "When something goes wrong",
      "at": 269.1
    }
  ],
} as const
