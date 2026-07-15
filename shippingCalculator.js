/**
 * Shipping & LTL Freight Calculator Engine (CommonJS version)
 */

/**
 * Parses size strings (e.g., "18\" x 24\"", "2ft x 1ft", "24x36") into inches and square footage.
 */
function parseDimensions(sizeStr) {
  if (!sizeStr) return { width: 12, height: 12, areaSqFt: 1 };

  try {
    const clean = sizeStr.replace(/\\/g, "").replace(/"/g, "").replace(/”/g, "").replace(/’/g, "'").trim();
    const parts = clean.split(/x|\*|by/i).map(p => p.trim());
    if (parts.length >= 2) {
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);

      const isWFeet = parts[0].includes("'") || parts[0].toLowerCase().includes("ft");
      const isHFeet = parts[1].includes("'") || parts[1].toLowerCase().includes("ft");

      const wIn = isWFeet ? w * 12 : w;
      const hIn = isHFeet ? h * 12 : h;

      if (isNaN(wIn) || isNaN(hIn)) {
        return { width: 12, height: 12, areaSqFt: 1 };
      }

      return {
        width: wIn,
        height: hIn,
        areaSqFt: (wIn * hIn) / 144
      };
    }
  } catch (e) {
    console.warn("Failed to parse size string:", sizeStr, e);
  }

  return { width: 12, height: 12, areaSqFt: 1 };
}

/**
 * Resolves weight, freight status, and packaged dimensions for an item based on its name and configuration.
 */
function getItemPhysicalSpecs(productTitle, sizeStr, itemData = {}) {
  const title = (productTitle || "").toLowerCase();
  
  // Use direct width/height properties if available
  let width = parseFloat(itemData.widthIn);
  let height = parseFloat(itemData.heightIn);
  let areaSqFt = 1;

  if (isNaN(width) || isNaN(height)) {
    const dims = parseDimensions(sizeStr);
    width = dims.width;
    height = dims.height;
    areaSqFt = dims.areaSqFt;
  } else {
    areaSqFt = (width * height) / 144;
  }

  let weightLbs = 1.0;
  let isFreight = false;
  let lengthInches = Math.max(width, height);
  let widthInches = Math.min(width, height);
  let heightInches = 1.0; // Packaged thickness

  // Categorized weight mappings
  if (title.includes("neon") || title.includes("cup") || title.includes("sign")) {
    // Custom or World Cup Neon Sign
    // Signs have acrylic backing (1.25 lbs/sqft) + LED flex strips + wires + adapter
    weightLbs = Math.max(3.0, areaSqFt * 1.6);
    lengthInches = Math.max(width, height) + 2; // package buffer
    widthInches = Math.min(width, height) + 2;
    heightInches = 2.5; // package depth
  } else if (title.includes("banner")) {
    if (title.includes("retractable") || title.includes("roll up") || title.includes("roll-up")) {
      weightLbs = 12.0;
      lengthInches = 36.0;
      widthInches = 6.0;
      heightInches = 6.0;
    } else {
      const multiplier = title.includes("fabric") ? 0.07 : 0.11;
      weightLbs = Math.max(1.0, areaSqFt * multiplier);
      lengthInches = Math.max(12, lengthInches);
      widthInches = Math.max(6, widthInches / 4);
      heightInches = 4.0;
    }
  } else if (title.includes("tent") || title.includes("canopy")) {
    weightLbs = 48.0;
    lengthInches = 62.0;
    widthInches = 10.0;
    heightInches = 10.0;
    isFreight = true;
  } else if (title.includes("a-frame")) {
    weightLbs = 22.0;
    lengthInches = 42.0;
    widthInches = 26.0;
    heightInches = 5.0;
  }

  // Dimension & Girth LTL freight check
  const girth = lengthInches + 2 * (widthInches + heightInches);
  if (weightLbs > 150 || lengthInches > 96 || girth > 130) {
    isFreight = true;
  }

  return {
    weightLbs,
    isFreight,
    lengthInches,
    widthInches,
    heightInches,
  };
}

/**
 * Calculates local, ground, and LTL rates based on items, zip code, and LTL surcharges.
 */
function calculateShippingRates(items, zipCode, options = {}) {
  let totalWeight = 0;
  let hasFreightItem = false;
  let maxSingleDimension = 0;

  for (const item of items) {
    const size = item.size || (item.widthIn && item.heightIn ? `${item.widthIn}x${item.heightIn}` : "24x24");
    const specs = getItemPhysicalSpecs(item.productTitle || item.text, size, item);
    const itemTotalWeight = specs.weightLbs * (item.quantity || 1);
    totalWeight += itemTotalWeight;

    if (specs.isFreight) {
      hasFreightItem = true;
    }

    const itemMaxDim = Math.max(specs.lengthInches, specs.widthInches);
    if (itemMaxDim > maxSingleDimension) {
      maxSingleDimension = itemMaxDim;
    }
  }

  if (totalWeight > 150 || maxSingleDimension > 96) {
    hasFreightItem = true;
  }

  // Always supply a Local Pickup option (Free)
  const rates = [
    {
      id: "local_pickup",
      name: "Free Local Pickup",
      price: 0.0,
      deliveryEstimate: "Next Business Day",
      description: "Pick up at our main storefront headquarters.",
      minDays: 1,
      maxDays: 1
    },
  ];

  const zip = (zipCode || "").trim();
  
  // Default to local Florida rates if no valid zip is parsed
  const isLocalZone = zip.startsWith("330") || zip.startsWith("331") || zip.startsWith("332") || zip.startsWith("333") || zip.startsWith("334");
  const isStateZone = zip.startsWith("32") || zip.startsWith("33") || zip.startsWith("34");

  let zoneMultiplier = 1.0;
  if (zip.length >= 5) {
    if (!isStateZone) {
      zoneMultiplier = 1.4; // Out of state
    } else if (!isLocalZone) {
      zoneMultiplier = 1.15; // In-state long distance
    }
  }

  if (hasFreightItem) {
    // ── LTL Freight Pricing Rules ──
    let baseFreight = 120.0;
    if (zip.length >= 5) {
      if (!isLocalZone) baseFreight = 180.0;
      if (!isStateZone) baseFreight = 290.0;
    }

    const weightAdder = totalWeight * 1.1 * zoneMultiplier;
    let freightCost = baseFreight + weightAdder;

    // Apply accessory fees (residential is default true for freight, liftgate is optional)
    if (options.residential !== false) {
      freightCost += 55.0; // Residential delivery surcharge
    }
    if (options.liftgate) {
      freightCost += 45.0; // Liftgate unloading surcharge
    }

    rates.push({
      id: "ltl_freight",
      name: "LTL Freight Shipping",
      price: Math.round(freightCost * 100) / 100,
      deliveryEstimate: isLocalZone || zip.length < 5 ? "2-3 Business Days" : "4-7 Business Days",
      description: `Freight LTL delivery for heavy/oversized items. ${
        options.liftgate ? "Includes liftgate service." : "Dock or manual unloading required."
      }`,
      minDays: isLocalZone || zip.length < 5 ? 2 : 4,
      maxDays: isLocalZone || zip.length < 5 ? 3 : 7
    });
  } else {
    // ── Standard Courier Shipping Rules ──
    let baseStandard = 9.95;
    let baseExpedited = 24.95;

    if (zip.length >= 5) {
      if (!isLocalZone) {
        baseStandard = 14.95;
        baseExpedited = 39.95;
      }
      if (!isStateZone) {
        baseStandard = 19.95;
        baseExpedited = 59.95;
      }
    }

    const standardCost = Math.round((baseStandard + totalWeight * 0.75 * zoneMultiplier) * 100) / 100;
    const expeditedCost = Math.round((baseExpedited + totalWeight * 1.5 * zoneMultiplier) * 100) / 100;

    rates.push({
      id: "standard_ground",
      name: "Standard Courier (Ground)",
      price: standardCost,
      deliveryEstimate: isLocalZone || zip.length < 5 ? "Next Business Day" : isStateZone ? "2 Business Days" : "3-5 Business Days",
      description: "Delivered directly to your door via standard ground courier.",
      minDays: isLocalZone || zip.length < 5 ? 1 : isStateZone ? 2 : 3,
      maxDays: isLocalZone || zip.length < 5 ? 1 : isStateZone ? 2 : 5
    });

    rates.push({
      id: "expedited_courier",
      name: "Expedited Courier (Express)",
      price: expeditedCost,
      deliveryEstimate: isLocalZone || zip.length < 5 ? "Next Day Morning" : "1-2 Business Days",
      description: "Prioritized air/express shipment.",
      minDays: 1,
      maxDays: isLocalZone || zip.length < 5 ? 1 : 2
    });
  }

  return rates;
}

module.exports = {
  parseDimensions,
  getItemPhysicalSpecs,
  calculateShippingRates
};
