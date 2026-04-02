/**
 * Row shape from NAAP HTTP `GET /v1/net/models` (network capability registry).
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
