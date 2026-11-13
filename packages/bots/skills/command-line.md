name: Working on the command line
description: Video, audio, pictures, scans, PDFs, data and batch jobs with run_command.
pickable: yes
---
- Work in the folder the files are in, and write results next to them with clear names (never over the original unless asked). Use /tmp for in-between files: it's emptied after each run. Quote paths: names often have spaces.
- Check first, then do: ffprobe -hide_banner "in.mp4", identify "photo.jpg", pdfinfo "doc.pdf", head -5 "data.csv". Check the result the same way before saying it's done.
- Video and audio (ffmpeg -hide_banner -y):
  - trim: ffmpeg -ss 00:00:10 -to 00:00:20 -i in.mp4 -c copy clip.mp4 (re-encode with -c:v libx264 -c:a aac if the cut looks wrong);
  - shrink for sending: -vf "scale=-2:720" -c:v libx264 -crf 28 -preset veryfast -c:a aac -b:a 96k;
  - GIF: ffmpeg -t 5 -i in.mp4 -vf "fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" out.gif;
  - sound only: -vn -c:a libmp3lame -q:a 3 out.mp3; a still: -ss 3 -frames:v 1 thumb.jpg.
- Pictures (ImageMagick 6: convert, mogrify, identify): convert in.heic out.jpg; resize many: mkdir -p small && mogrify -path small -resize 1600x1600\> -quality 85 *.jpg; strip location data: -strip. Pillow in Python for drawing and finer work.
- Scanned pages: pdftoppm -r 300 -png scan.pdf /tmp/p; then for f in /tmp/p*.png; do tesseract "$f" - -l eng; done (fra, deu, ita, spa, por too; join with +). For a searchable PDF: tesseract page.png out -l eng pdf. Digital PDFs: pdftotext -layout doc.pdf -.
- PDFs: merge qpdf --empty --pages a.pdf b.pdf -- both.pdf; split qpdf in.pdf --pages . 1-3 -- part.pdf; compress gs -sDEVICE=pdfwrite -dPDFSETTINGS=/ebook -o small.pdf in.pdf.
- Data (python3 with pandas): read_csv / read_excel, groupby and sum, to_excel("totals.xlsx", index=False); charts with matplotlib, saved as PNG (savefig, dpi=150). sqlite3 for big tables; jq for JSON.
- Documents: pandoc notes.md -o notes.docx (or .html, .odt); python-docx and python-pptx when a file needs building piece by piece; the office apps (use_app) for editing real Word, Excel and PowerPoint files with their formatting.
- Archives: unzip -l, unzip -d, zip -r, tar -xf, 7z x.
- Code: Node.js 26 with npm, Python 3, git and sqlite3. Run a project's tests (npm test, node --test, python3 -m unittest) after every change. Nothing can be installed (no internet): use what the project already has in node_modules, or the standard library.
- Long jobs (big videos, hundreds of files) may go on in the background: say you're on it; you're woken when it ends.
