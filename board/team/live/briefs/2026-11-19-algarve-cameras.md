# Algarve cameras: Dinis's word, 19 Nov 2026, about 17:32 UTC

Dinis's words, as given in this session (transcribed from speech, kept as said):

> "So I think, look, remember at the end of the day, like we link to them, right? So, and they are public. So, like those skyline webcams for Faro and Lagos and everything there, I think it should be okay, right? And the Mayo Beach Camp, can you, I'm not able to take a look at it. The Mayo Beach Camp, can you give me the page, the terms and conditions?"

("Mayo Beach Camp" is MEO BeachCam.)

## What follows from it
- **SkylineWebcams (Lagos, Faro and other Algarve places): yes.** data.b@ read the terms. They allow embedding with SkylineWebcams' own embed code, unmodified, and ban scraping and republishing. So live shows each camera through that embed code, with the credit and a link to SkylineWebcams' page, and never re-hosts, records or analyses a picture. The cameras go into data.promptugal.news's register first (data.b@'s work); live adds the embed host only after reading the terms itself.
- **MEO BeachCam:** the terms page is https://beachcam.meo.pt/termos-e-condicoes/. live.b@ read it at 17:33 UTC. Section 1 says retransmitting or making available the livecams' live streams on third-party websites, apps or platforms needs prior, express authorisation from the rights holders. Linking is not forbidden. So, until MEO agrees, MEO BeachCam cameras can be listed as links only. Asking MEO is outreach@'s to draft and a person's to send (open ask).

## Dinis's word, about 17:34 UTC

> "So remember that at least we should be putting them on the videos page. I think it's different on the name side, but at least on the data, so on the videos page or even on the weather page, we're not commercializing them, right?"

What live.b@ takes from it:
- MEO BeachCam's cameras go into the data (the register) and onto the videos and weather pages, and live's too, **as links**: the camera's name, place and MEO's page, credited. Linking is not forbidden by MEO's terms.
- Not commercialising them does not change the embed rule: MEO's terms ask for prior, express authorisation to retransmit or make the live streams available on any third-party site, and they make no exception for non-commercial use. So no MEO player is shown on any site until MEO agrees.

## Dinis's word, about 17:36 UTC

> "Okay, yeah, so maybe capture that as mail, as something to contact. I can do it later. Maybe put on the website, link. Maybe, again, you have two maybe sets of maps. One maps where it exists and one maps you can actually show. That we need to reach out to them. On the maps, I was thinking that, are we able to get directions? If I put two addresses, for example, in London or even in Portugal, can, by the way, we now are able to access Google APIs directly, even if there's a cost. But for example, I'm about to do a travel now. Could I just put my directions and get Google Maps and then even show a video of the traffic, which would be pretty cool? Because I don't think that service exists right now with actually live footage of cameras. And I could even create a page that has that. Also the cameras that exist on the way that I'm about to go, which would be quite cool."

What live.b@ takes from it:
1. **A drafted email to MEO BeachCam** asking permission to embed. Dinis sends it later; live.b@ only drafts.
2. **The cameras as links on the website**, and **two maps**: one of every camera that exists, and one of the cameras we can show. Link-only cameras are marked as ones we need to ask.
3. **A route page (proposal):** two addresses in, a Google route out. The page then lists the cameras along the way, in order, each playable by a click, so you see live traffic on your route. It needs a Google Maps Platform key (Dinis's to create, with a budget cap), a security pre-review, and the page must say plainly that the addresses go to Google.

## Dinis's word, about 17:41 UTC: the route page moves to SovereignWebsite

> "Okay, can you pass these Google Maps to the sovereign website example? Because I will do this as a power there. So let's do a Google Maps, google-maps.sovereign website. That's a perfect example of using a third-party service, but in a pure sovereignty way."

What live.b@ takes from it:
- The route page (two addresses, Google's route, the cameras on the way, each playable) becomes a SovereignWebsite example, google-maps on the SovereignWebsite domain. live.b@ does not build it. The brief went to conductor.b@SovereignWebsite.dinis at about 17:43 UTC.
- Live's part: the cameras as data. https://live.promptugal.news/api/v1/cameras.json (with its OpenAPI) gives each camera's coordinates, its operator's embed or link, and the credit. Live keeps that file stable for the example to read.
- The Google Maps Platform key ask moves with it (to that team's asks).
