type Scale<K extends string | number> = Readonly<Record<K, string>>;

export declare const brand: Scale<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950>;
export declare const sun: Scale<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900>;
export declare const clay: Scale<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900>;
export declare const sand: Scale<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950>;
export declare const ink: Readonly<{ DEFAULT: string; muted: string; subtle: string }>;
export declare const bead: Readonly<{ green: string; gold: string; red: string; blue: string; black: string }>;
