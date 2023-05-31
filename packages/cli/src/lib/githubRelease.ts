import fetch from 'node-fetch';
import { createWriteStream, WriteStream } from 'fs';

interface GithubReleaseAsset {
  name: string;
  content_type: string;
  browser_download_url: string;
}

export default class GithubRelease {
  repoOwner: string;
  repoName: string;

  constructor(repoOwner: string, repoName: string) {
    this.repoOwner = repoOwner;
    this.repoName = repoName;
  }

  async getLatestAssets(): Promise<Array<GithubReleaseAsset>> {
    const url = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`;
    const response = await fetch(url);
    const { assets } = (await response.json()) as { assets: Array<GithubReleaseAsset> };
    return assets;
  }

  static downloadAsset(asset: GithubReleaseAsset, path: string): Promise<void> {
    return fetch(asset.browser_download_url).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is empty');
      }

      const fileStream: WriteStream = createWriteStream(path);
      response.body.pipe(fileStream);
      response.body.on('error', (e) => {
        throw new Error(e);
      });

      return new Promise((resolve) => {
        fileStream.on('finish', resolve);
      });
    });
  }
}
