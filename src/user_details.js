const Apify = require('apify');
const got = require('got');
const tunnel = require('tunnel');
const { CookieJar } = require('tough-cookie');
const { log } = require('./helpers');

const users = {};

async function expandOwnerDetails(posts, page, itemSpec, proxy) {
    log(itemSpec, `Expanding owner details for ${posts.length} items.`);
    let proxyConfig = { ...proxy };

    const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 105.0.0.11.118 (iPhone11,8; iOS 12_3_1; en_US; en-US; scale=2.00; 828x1792; 165586599)';

    let proxyUrl = null;
    if (proxyConfig.useApifyProxy) {
        proxyUrl = Apify.getApifyProxyUrl({
            groups: proxyConfig.apifyProxyGroups || [],
            session: proxyConfig.apifyProxySession || `insta_session_${Date.now()}`,
        });
    } else {
        const randomUrlIndex = Math.round(Math.random() * proxyConfig.proxyUrls.length);
        proxyUrl = proxyConfig.proxyUrls[randomUrlIndex];
    }

    const proxyUrlParts = proxyUrl.match(/http:\/\/(.*)@(.*)\/?/);
    if (!proxyUrlParts) return posts;

    const proxyHost = proxyUrlParts[2].split(':');
    proxyConfig = {
        hostname: proxyHost[0],
        proxyAuth: proxyUrlParts[1],
    }
    if (proxyHost[1]) proxyConfig.port = proxyHost[1];

    const agent = tunnel.httpsOverHttp({
        proxy: proxyConfig,
    });

    const cookies = await page.cookies();
    const cookieJar = new CookieJar();
    cookies.forEach((cookie) => {
        if (cookie.name === 'urlgen') return;
        cookieJar.setCookieSync(`${cookie.name}=${cookie.value}`, 'https://i.instagram.com/', { http: true, secure: true });
    });
    await Apify.utils.sleep(10 * 1000);

    const transformedPosts = [];
    let retries = 0;
    for (let i = 0; i < posts.length && retries < 10; i++) {
        if (!posts[i].ownerId) {
            transformedPosts.push(posts[i]);
            continue;
        }
        const newPost = { ...posts[i] };
        if (users[posts[i].ownerId]) {
            newPost.ownerUsername = users[posts[i].ownerId].username;
            newPost.owner = users[posts[i].ownerId];
            transformedPosts.push(newPost);
            continue;
        }
        try {
            const { body } = await got(`https://i.instagram.com/api/v1/users/${posts[i].ownerId}/info/`, { 
                json: true, 
                cookieJar, 
                agent,
                headers: {
                    'user-agent': userAgent,
                }
            });
            users[posts[i].ownerId] = body.user;
            newPost.ownerUsername = users[posts[i].ownerId].username;
            newPost.owner = users[posts[i].ownerId];
            transformedPosts.push(newPost);
            retries = 0;
        } catch (error) {
            await Apify.utils.log.error(error);
            i--;
            retries++;
        }
        await Apify.utils.sleep(500);
    }
    log(itemSpec, `Owner details for ${posts.length} items expanded.`);
    return transformedPosts;
}

module.exports = {
    expandOwnerDetails,
};