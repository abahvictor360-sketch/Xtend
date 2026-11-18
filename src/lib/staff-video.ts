// Made by scripts/make-staff-video.ts: do not edit by hand.

/** The staff video guide, its length and where each chapter starts (seconds). */
export const STAFF_VIDEO = {
  src: '/guide/xtend-staff-guide.mp4',
  poster: '/guide/xtend-staff-guide.jpg',
  seconds: 229,
  chapters: [
    {
      "title": "Get the app",
      "at": 5
    },
    {
      "title": "Sign in",
      "at": 26
    },
    {
      "title": "Allow location, camera and notifications",
      "at": 41
    },
    {
      "title": "Finish setting up: location and battery",
      "at": 65
    },
    {
      "title": "Your photo",
      "at": 108
    },
    {
      "title": "Clock in",
      "at": 117
    },
    {
      "title": "Store visits (marketers)",
      "at": 143
    },
    {
      "title": "Daily report",
      "at": 160
    },
    {
      "title": "Clock out",
      "at": 171
    },
    {
      "title": "When something goes wrong",
      "at": 187
    }
  ],
} as const
