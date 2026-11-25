# Bridging Code and Intent

An AI collaboration layer for software teams. It detects significant changes and design drift across pull requests, issues, and commits, then turns them into the right updates for the right people: technical context for engineers, progress and risk reports for managers.

## Report and presentation workflow

Project State -> LLM report -> manual editing -> Slidev web presentation, PPTX or portable ZIP.

[Setup and usage](slide-generator/README.md) | [Tests](slide-generator/TESTING.md)

Module guides: [Report Agent](slide-generator/report-agent/README.md), [exports](slide-generator/slide-export/README.md), [Mock storage](slide-generator/mock-firebase/README.md), [historical reconstruction](slide-generator/state-replay/README.md).

The website currently uses local Mock data; formal Firebase integration and deployment are outside this contribution.
