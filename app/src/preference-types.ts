import type {Query} from './presentation';
export type ReadingEntry={query:Query;mode:string;page:number;scroll:Record<string,number>};
export type ReadingPreferences={version:1;activeEntry:string;entries:Record<string,ReadingEntry>};
