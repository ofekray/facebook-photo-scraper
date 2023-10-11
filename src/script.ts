import path from "path";
import { initPuppeter, loginFacebook } from "./utils/puppeteer.utils";
import { Page, } from "puppeteer";
import fs from 'fs';
import { randomUUID } from "crypto";

/* pkg doesn't support esm */
const axios = require('axios/dist/node/axios.cjs');
const {downloadBrowser} = require('puppeteer/lib/cjs/puppeteer/node/install.js');
/* pkg doesn't support esm */

const getDir = () => {
    return process.cwd();
}

const config = JSON.parse(fs.readFileSync(path.join(getDir(), "config.json"), 'utf8'));

const getPhotoPages = (profileUrl: string) => {
    const match = profileUrl.match(/profile\.php\?id=(\d+)/);
    if (match && match[1]) {
        const id = match[1];
        return [
            `https://www.facebook.com/profile.php?id=${id}&sk=photos`,
            `https://www.facebook.com/profile.php?id=${id}&sk=photos_of`,
        ];
    }
    else {
        const match = profileUrl.match(/facebook\.com\/([^/]+)/);
        if (match && match[1]) {
            const id = match[1];
            return [
                `https://www.facebook.com/${id}/photos`,
                `https://www.facebook.com/${id}/photos_of`,
            ];
        }
        else {
            console.warn("No id found for url: " + profileUrl);
            return [];
        }
    }
};

const getPhotoLinks = async (page: Page, profileLink: string) => {
    const photoPages = getPhotoPages(profileLink);

    const photoLinks: string[] = [];
    const visitedPhotoIds = new Set<string>();

    for (const photoPage of photoPages) {
        console.log(`Visiting ${photoPage}...`);
        // Go to the photo page
        await page.goto(photoPage);

        // @ts-ignore
        const linksInPage = await page.evaluate(() => {
            let links = [];
            let photos = document.querySelectorAll<HTMLLinkElement>('a[role="link"][href^="https://www.facebook.com/photo.php?fbid="]');
            for (let i = 0; i < photos.length; i++) {
                const link = photos[i].href;
                links.push(link);
            }
            return links;
        });
        for (const link of linksInPage) {
            const match = link.match(/fbid=(\d+)/);
            if (match && match[1]) {
                const id = match[1];
                if (!visitedPhotoIds.has(id)) {
                    visitedPhotoIds.add(id);
                    console.log(`Found photo with id ${id}.`);
                    photoLinks.push(link);
                }
            }
        }
    }

    console.log(`Found a total of ${photoLinks.length} photos.`);

    return photoLinks;
};

const downloadLinks = async (page: Page, name: string, photoLinks: string[]) => {
    let photosDir = path.join(getDir(), `photos/${name}/${randomUUID()}`);
    if (!fs.existsSync(photosDir)) {
        fs.mkdirSync(photosDir, {recursive: true});
    }


    for (let i = 0; i < photoLinks.length; i++) {
        await page.goto(photoLinks[i]);

        const imageSelector = '[data-visualcompletion="media-vc-image"]';
        await page.waitForSelector(imageSelector);

        const filename = path.join(
            photosDir,
            // @ts-ignore
            `${path.basename(await page.$eval(imageSelector, (img: any) => img.src)).split('.jpg')[0]}.jpg`
        );

        // Download the photo
        // @ts-ignore
        const fileUrl = await page.$eval(imageSelector, (img: any) => img.src);

        const response = await axios.get(fileUrl as string, {
            responseType: 'stream'
        });

        response.data.pipe(fs.createWriteStream(filename));

        console.log(`Downloading photo ${i + 1}/${photoLinks.length}...`);

        await page.waitForTimeout(1000);
    }
};

const downloadPhotos = async (page: Page, name: string, profileLink: string) => {
    const photoLinks = await getPhotoLinks(page, profileLink);
    await downloadLinks(page, name, photoLinks);
};

const script = async () => {
    const csv = fs.readFileSync(path.join(getDir(), "names.csv"), 'utf8');
    const lines = csv.split("\n");

    console.log("Downloading browser...");
    await downloadBrowser();

    console.log("Starting browser...");
    const browser = await initPuppeter(config.headless);
    const page = await browser.newPage();
    page.setViewport({ width: 1500, height: 764 });

    console.log("Logging in...");
    await loginFacebook(page, { username: config.username, password: config.password });

    let lineCount = 0;
    for (const line of lines) {
        if (lineCount > 0) {
            const [name, profileLink] = line.split(",");
            console.log(`Starting downloading photos for ${name}...`);
            await downloadPhotos(page, name, profileLink);
            console.log(`Finished downloading photos for ${name}.`);
        }
        lineCount++;
    }
};

script().then(() => {
    console.log("Finished.");
    process.exit(0);
}
).catch((error) => {
    console.error(error);
    process.exit(1);
});

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ', err);
});