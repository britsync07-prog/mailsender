declare module 'spintax-extended' {
  type SpintaxTypes = 'text' | 'or' | 'and';

  interface SpintaxData {
    readonly type: SpintaxTypes;
    readonly value?: string;
    readonly values?: ReadonlyArray<ReadonlyArray<SpintaxData> | SpintaxData>;
    readonly separator?: ReadonlyArray<ReadonlyArray<SpintaxData> | SpintaxData> | string;
  }

  type ParsingResult = ReadonlyArray<SpintaxData> | SpintaxData;

  class Spintax {
    readonly rawtext: string;
    readonly data: ParsingResult;
    constructor(text: string);
    static unspin(text: string): string;
    static countVariations(text: string): number;
    static unspinByIndex(text: string, index: number): string;
    static fullUnspinList(text: string): string[];
    static randomUnspinList(text: string, size: number, unique: boolean): string[];
    static isCorrect(text: string): boolean;
    unspin(): string;
    countVariations(): number;
    unspinByIndex(index: number): string;
    fullUnspinList(): string[];
    randomUnspinList(size: number, unique: boolean): string[];
    isCorrect(): boolean;
  }

  export default Spintax;
}
