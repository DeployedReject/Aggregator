export default {
  id: "internet-archive",
  name: "Internet Archive",
  baseUrl: "https://archive.org",
  version: "1.0.1",
  author: "Community",
  description: "Public domain movies, historical archives, and cultural media from archive.org",

  async getHome() {
    return this.search("");
  },

  async search(query) {
    try {
      const q = query && query.trim()
        ? `title:(${encodeURIComponent(query.trim())}) AND mediatype:(movies)`
        : "mediatype:(movies) AND collection:(feature_films OR movies) AND (format:h.264 OR format:MP4)";
      const url = `https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier,title,description,downloads&sort[]=downloads+desc&rows=30&output=json`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      const docs = data?.response?.docs || [];
      return docs.map((doc) => ({
        id: doc.identifier,
        title: doc.title || doc.identifier || "Untitled",
        description: doc.description || "",
        coverUrl: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
        url: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
      }));
    } catch (e) {
      console.error("[InternetArchive] Search error:", e);
      return [];
    }
  },

  async getEpisodes(mediaId) {
    try {
      const cleanId = mediaId.replace(/^https?:\/\/[^\/]+\/(details\/)?/, "").split("?")[0].split(":")[0].trim();
      const url = `https://archive.org/metadata/${encodeURIComponent(cleanId)}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      const files = data?.files || [];

      // Filter all video candidates
      const allVideos = files.filter((f) => {
        const name = (f.name || "").toLowerCase();
        return name.match(/\.(mp4|mkv|avi|webm|m4v|ogv)$/i) || (f.format && /h\.264|mp4|matroska/i.test(f.format));
      });

      if (allVideos.length === 0) {
        return [
          {
            id: `${cleanId}:main`,
            number: 1,
            title: data?.metadata?.title || cleanId,
            url: `https://archive.org/details/${encodeURIComponent(cleanId)}`,
          },
        ];
      }

      // Track available MP4 derivative files so we always stream web-playable H.264 MP4s over raw MKV/AVI
      const mp4Set = new Set(files.filter((f) => (f.name || "").toLowerCase().endsWith(".mp4")).map((f) => f.name));

      const uniqueByBase = new Map();
      for (const file of allVideos) {
        const baseName = file.name.replace(/\.[^/.]+$/, "");
        const mp4Candidate = `${baseName}.mp4`;
        const streamFile = mp4Set.has(mp4Candidate)
          ? mp4Candidate
          : (file.name.toLowerCase().endsWith(".mp4") ? file.name : mp4Candidate);

        if (!uniqueByBase.has(baseName) || file.name.toLowerCase().endsWith(".mp4")) {
          uniqueByBase.set(baseName, { ...file, streamFile });
        }
      }

      let index = 1;
      return Array.from(uniqueByBase.values()).map((file) => {
        let num = index;
        const epMatch = file.name.match(/(?:[Ee]p(?:isode)?\s*_?-?\s*0*|s\d+e0*|-?\s*0*)(\d+)/i);
        if (file.track && !isNaN(parseInt(file.track, 10))) {
          num = parseInt(file.track, 10);
        } else if (epMatch) {
          num = parseInt(epMatch[1], 10);
        }
        index++;

        return {
          id: `${cleanId}:${encodeURIComponent(file.streamFile)}`,
          number: num,
          title: file.title || file.name.replace(/\.[^/.]+$/, ""),
          url: `https://archive.org/details/${encodeURIComponent(cleanId)}`,
        };
      });
    } catch (e) {
      console.error("[InternetArchive] getEpisodes error:", e);
      return [];
    }
  },

  async getStreams(episodeId) {
    try {
      const parts = episodeId.split(":");
      const cleanId = parts[0];
      let fileName = parts.slice(1).join(":");

      if (!fileName || fileName === "main") {
        const url = `https://archive.org/metadata/${encodeURIComponent(cleanId)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const files = data?.files || [];
          const videoFile = files.find((f) => (f.name || "").toLowerCase().endsWith(".mp4")) || files[0];
          if (videoFile) fileName = videoFile.name;
        }
      }

      let decodedName = decodeURIComponent(fileName || "");
      // Map non-browser extensions (.mkv, .avi) to the browser-playable .mp4 derivative
      decodedName = decodedName.replace(/\.(mkv|avi|wmv|ogv)$/i, ".mp4");

      // Use /serve/ for streaming media players with 206 Partial Content and Range headers
      const streamUrl = `https://archive.org/serve/${encodeURIComponent(cleanId)}/${encodeURIComponent(decodedName)}`;

      return [
        {
          quality: "Auto",
          url: streamUrl,
          type: "sub",
        },
      ];
    } catch (e) {
      console.error("[InternetArchive] getStreams error:", e);
      return [];
    }
  },
};
