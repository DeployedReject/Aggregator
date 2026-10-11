export default {
  id: "internet-archive",
  name: "Internet Archive",
  baseUrl: "https://archive.org",
  version: "1.0.0",
  author: "Community",
  description: "Public domain movies, historical archives, and cultural media from archive.org",

  async getHome() {
    return this.search("");
  },

  async search(query) {
    try {
      const q = query && query.trim()
        ? `title:(${encodeURIComponent(query.trim())}) AND mediatype:movies AND (format:h.264 OR format:MP4)`
        : "mediatype:movies AND collection:feature_films AND (format:h.264 OR format:MP4)";
      const url = `https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier,title,description,downloads&sort[]=downloads+desc&rows=25&output=json`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      const docs = data?.response?.docs || [];
      return docs.map((doc) => ({
        id: doc.identifier,
        title: doc.title || doc.identifier,
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
      const cleanId = mediaId.replace(/^https?:\/\/[^\/]+\/(details\/)?/, "").split("?")[0].trim();
      const url = `https://archive.org/metadata/${encodeURIComponent(cleanId)}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      const files = data?.files || [];

      const videoFiles = files.filter((f) => {
        const name = (f.name || "").toLowerCase();
        return name.endsWith(".mp4") || name.endsWith(".webm") || (f.format && /h\.264|mp4/i.test(f.format));
      });

      if (videoFiles.length === 0) {
        return [
          {
            id: `${cleanId}:main`,
            number: 1,
            title: data?.metadata?.title || "Feature Film",
            url: `https://archive.org/details/${encodeURIComponent(cleanId)}`,
          },
        ];
      }

      return videoFiles.map((file, idx) => ({
        id: `${cleanId}:${encodeURIComponent(file.name)}`,
        number: idx + 1,
        title: file.title || file.name || `Video Part ${idx + 1}`,
        url: `https://archive.org/download/${encodeURIComponent(cleanId)}/${encodeURIComponent(file.name)}`,
      }));
    } catch (e) {
      console.error("[InternetArchive] getEpisodes error:", e);
      return [];
    }
  },

  async getStreams(episodeId) {
    try {
      const parts = episodeId.split(":");
      const cleanId = parts[0];
      const fileName = parts.slice(1).join(":");

      if (fileName && fileName !== "main") {
        const directUrl = `https://archive.org/download/${encodeURIComponent(cleanId)}/${fileName}`;
        return [
          {
            mode: "direct",
            url: directUrl,
            type: "video/mp4",
            quality: "Original",
          },
        ];
      }

      const url = `https://archive.org/metadata/${encodeURIComponent(cleanId)}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      const files = data?.files || [];
      const videoFile = files.find((f) => (f.name || "").toLowerCase().endsWith(".mp4")) || files[0];

      if (videoFile) {
        const directUrl = `https://archive.org/download/${encodeURIComponent(cleanId)}/${encodeURIComponent(videoFile.name)}`;
        return [
          {
            mode: "direct",
            url: directUrl,
            type: "video/mp4",
            quality: "Original",
          },
        ];
      }
      return [];
    } catch (e) {
      console.error("[InternetArchive] getStreams error:", e);
      return [];
    }
  },
};
