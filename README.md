![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Status](https://img.shields.io/badge/Status-Active-brightgreen.svg)
![Platform](https://img.shields.io/badge/Platform-Snap_Spectacles-black.svg)
![Tech](https://img.shields.io/badge/Powered_by-Lens_Studio_5.15-yellow.svg)
<h1 align="center">DGNS Pocket Garage</h1>
<p align="center">
  <em>
    An open-source AR vehicle scanner Lens for Snap Spectacles, allowing users to scan real vehicles,
    generate collectible cards, level up, and sync their garage in the cloud.
  </em>
</p>
<p align="center">
  <img width="800" height="450" alt="ezgif-550515ecb76da076" src="https://github.com/user-attachments/assets/f27dea45-2263-4322-b9b6-f58e4fa39d16" />
</p>

---

## Overview

**DGNS Pocket Garage** is an open-source Lens project designed for **Snap Spectacles**.  
It provides a complete gameplay loop to scan vehicles in the real world, generate collectible cards, and build a persistent AR garage.

The project is intended as:
- a **technical reference**
- a **creative playground**
- and a **starting point** for custom Spectacles automotive/gameified experiences

Users are responsible for respectful and lawful use of scanned content and cloud features.

---

## Features

- **AI Vehicle Scanning**  
  Capture and identify real vehicles, then generate a rich vehicle card.

- **Collectible Card System**  
  Save scanned cars, manage rarity, browse your collection, and visualize cards in AR.

- **XP / Progression**  
  Earn XP, level up, prestige, and track streak/progression metrics.

- **Cloud Sync (Supabase + Snap Cloud)**  
  Sync profiles, collection data, leaderboard stats, card images, and sharing features.

- **Connected Lens Multiplayer**  
  Start shared sessions, synchronize interactions, and exchange cards with other players.

- **Narration + UI Feedback**  
  Includes dynamic text narration, status messages, and immersive SFX flow.

---

## Scripts

| Script | What it does |
|---|---|
| **Car_Scanner.ts** | The brain of the app — connects all the other scripts together so they work as one. |
| **VehicleScanner.ts** | Takes a photo with the Spectacles camera and asks AI (GPT-4o) to identify the vehicle in it. |
| **VehicleCardUI.ts** | Displays the vehicle info card on screen (name, stats, rarity) and manages its loading/error states. |
| **VehicleNarrator.ts** | Reads out a fun description of the scanned vehicle using text-to-speech and scrolling subtitles. |
| **VehicleTypes.ts** | Defines the shared data structures (what a "vehicle" looks like in code) used by all other scripts. |
| **CollectionManager.ts** | Saves your scanned cars, manages the rotating card carousel, and generates AI collector card images. |
| **CardInteraction.ts** | Lets you grab, move, and swipe through your collection cards using your hands. |
| **XPManager.ts** | Tracks your XP, level, daily streak, and prestige — and shows the animated +XP popup when you earn points. |
| **CloudManager.ts** | Syncs your garage, profile, and leaderboard score to the cloud (Supabase + Snap Cloud). |
| **ConnectedLensManager.ts** | Handles multiplayer sessions so two players can see each other's garage and trade cards in the same space. |
| **WelcomeManager.ts** | Shows the welcome screen at launch, lets you pick your language (FR/EN/ES) and choose Solo or Multiplayer mode. |
| **BrandLogoLoader.ts** | Downloads and displays the correct brand logo (e.g. BMW, Toyota) on each vehicle card. |
| **Localization.ts** | Manages all the text translations so the app can display content in English, French, or Spanish. |

---

## Requirements

- **Lens Studio** (latest recommended)
- **Snap Spectacles** device for deployment/testing
- Internet access for cloud and multiplayer features
- Valid Snap Cloud / Supabase configuration for online features

---

## Installation

```bash
git clone https://github.com/DgnsGui/DGNS-Pocket-Garage.git
```

Open the project file in Lens Studio:

```bash
DGNS Vehicle Scanner - SNAPCLOUD.esproj
```

<p align="center">
  Developed with ❤️ by GuillaumeDGNS
</p>
