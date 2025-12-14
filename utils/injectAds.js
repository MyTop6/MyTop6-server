// utils/injectAds.js
export function injectAdsIntoFeed(items, options = {}) {
  const {
    interval = 6,     // every 6 bulletins
    maxAds = 3,       // don’t totally flood a feed
    adType = "generic",
  } = options;

  const result = [];
  let adCount = 0;

  items.forEach((item, index) => {
    result.push(item);

    const shouldInsertAd =
      (index + 1) % interval === 0 && adCount < maxAds;

    if (shouldInsertAd) {
      result.push({
        _id: `ad-${adCount}-${adType}`,
        isAd: true,
        adType,
        placementIndex: index,
      });
      adCount += 1;
    }
  });

  return result;
}