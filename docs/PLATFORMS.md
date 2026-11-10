# Platforms

Official posting routes only. No browser automation and no unofficial endpoints: both break the platforms' terms and get accounts banned.

**Limits and prices below change often. Check each platform's current docs before you rely on a number.**

| Platform | Route | Before you can post publicly | Limits to plan around |
|---|---|---|---|
| **YouTube Shorts** | YouTube Data API v3, `videos.insert`, OAuth per channel | Uploads from an unverified API project are locked to private until the project passes Google's audit. | Default quota allows about 6 uploads a day per project. Ask for more once you need it. |
| **TikTok** | Content Posting API (Direct Post) | A registered developer app and an audit. Unaudited apps can only post privately. | A daily cap per creator account. |
| **Instagram Reels** | Instagram Graph API content publishing | A Business or Creator account linked to a Facebook Page, plus Meta app review. | A rolling 24-hour cap per account, far above this tool's own ceiling. |
| **Facebook Reels** | Pages API | The same Meta app as Instagram. | |
| **X** | X API v2 media upload | A paid API plan. | Optional. Add it last. |
| Snapchat, Kick, others | No usable public upload API | | Upload by hand, or skip. |

## The shortcut: a posting service

A posting service holds apps that already passed those audits, and exposes one API for all the platforms. It costs roughly $30–150 a month and saves weeks of waiting. For M5, build the YouTube publisher first (the audit is the simplest), then one posting-service publisher, then direct TikTok and Meta publishers only if the fee stops being worth it.

Before you hand any service your accounts, read how it connects: it should use each platform's own OAuth screen, never your password.

## Apply early

The audits are the slowest part of the whole project: 1–4 weeks each. Apply for Google API verification, the TikTok audit and Meta app review as soon as you start M2, so they're done by the time M5 needs them.

## How often to post

One to three clips per account per day. More than that tends to cut reach rather than add to it, and it's the pattern platforms treat as spam. The tool's ceiling is 5 per account per day and can't be raised in config.

## Getting footage

| Where it lives | How to get it |
|---|---|
| Your own recordings | Drop them in the source folder. |
| A creator you work with | They send files, or share a drive folder. For Twitch, they can authorize your app and the API lists their VODs (planned ingest kind). |
| A clipping campaign | The campaign usually supplies the source files or says where to get them. |

YouTube's terms don't allow downloading videos except through features YouTube provides, so get the files from the creator directly.
