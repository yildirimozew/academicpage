# ETH MSc CS ECTS tracker

Static app at https://yildirimozen.com/ects/ served through the existing GitHub Pages/Jekyll deployment. The homepage and domain configuration do not change.

The public starting state in initial-plan.json is blank: no courses, grades or personal records are included. Import your saved JSON plan to populate this browser. On a first visit it loads from that file; subsequent edits autosave in the browser under a key scoped to /ects/. Saved browser data takes precedence over the starting snapshot. This is not a shared live database: edits on one device do not update another device or the repository. Export/import JSON backups to transfer later changes.

To update the starting snapshot, replace initial-plan.json with a valid tracker export, then deploy the site. The starting snapshot and all repository files are public on GitHub Pages. The original PDFs and student identifier are not included.

index.html has no Jekyll front matter so it is copied as a standalone app. All asset and JSON URLs are relative to this directory. No installation or build is required for the tracker.
