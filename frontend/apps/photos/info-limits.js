// Generated from shared/contract/photos-info.ts by scripts/contract.mjs; do not edit (run `node scripts/contract.mjs`).
// A photo's info (PHOTOS.md § Info): the numbers it may carry, each with its range, and its sizes.

/** @type {Readonly<typeof import('../../../shared/contract/photos-info.ts').INFO_NUMBERS>} */
export const INFO_NUMBERS = Object.freeze({"focal":[0,10000],"focal35":[0,10000],"exposure":[0,100000],"fnumber":[0,1000],"iso":[0,10000000],"bias":[-100,100],"program":[0,65535],"metering":[0,65535],"flash":[0,65535],"wb_mode":[0,65535],"orientation":[0,65535],"width":[0,1000000],"height":[0,1000000],"rating":[0,5],"film_mode":[0,65535],"saturation":[0,65535],"dr_setting":[0,65535],"dr_dev":[0,65535],"dr_priority":[0,65535],"dr_priority_auto":[0,65535],"dr_priority_fixed":[0,65535],"highlight":[-100000,100000],"shadow":[-100000,100000],"sharpness":[0,65535],"nr":[0,65535],"clarity":[-100000,100000],"grain":[-100000,100000],"grain_size":[0,65535],"chrome":[-100000,100000],"chrome_blue":[-100000,100000],"wb":[0,65535],"wb_kelvin":[0,65535],"wb_fine_r":[-100000,100000],"wb_fine_b":[-100000,100000],"mono_warm":[-128,127],"mono_green":[-128,127],"stab":[0,65535],"stab_mode":[0,65535]});

/** @type {Readonly<typeof import('../../../shared/contract/photos-info.ts').INFO_LIMITS>} */
export const INFO_LIMITS = Object.freeze({"json_bytes":2048,"text_chars":80});
