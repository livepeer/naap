/**
 * Row shape from merged NAAP OpenAPI v1 `streaming/models` + `requests/models`
 * (network capability registry).
 */

export interface NetworkModel {
  Pipeline: string;
  Model: string;
  WarmOrchCount: number;
  TotalCapacity: number;
  PriceMinWeiPerPixel: number;
  PriceMaxWeiPerPixel: number;
  PriceAvgWeiPerPixel: number;
}
