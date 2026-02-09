/**
 * Unit tests for Daydream API Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createStream,
  updateStreamParams,
  deleteStream,
  getStreamStatus,
  buildDefaultControlnets,
  buildControlnetsFromSliders,
  CONTROLNETS,
  PRESETS,
} from '../daydream.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Daydream API Client', () => {
  const TEST_API_KEY = 'test_api_key_123';
  const TEST_STREAM_ID = 'str_teststream123';

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createStream', () => {
    it('should create a stream successfully', async () => {
      const mockResponse = {
        id: TEST_STREAM_ID,
        output_playback_id: 'playback123',
        whip_url: 'https://ai.livepeer.com/live/video-to-video/stk_abc/whip',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await createStream(TEST_API_KEY);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.daydream.live/v1/streams',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ pipeline_id: 'pip_qpUgXycjWF6YMeSL' }),
        })
      );

      expect(result).toEqual(mockResponse);
    });

    it('should throw error on failed stream creation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(createStream(TEST_API_KEY)).rejects.toThrow(
        'Failed to create stream: 401 Unauthorized'
      );
    });
  });

  describe('updateStreamParams', () => {
    it('should update stream parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const params = {
        prompt: 'anime style',
        negative_prompt: 'blurry',
        seed: 123,
        num_inference_steps: 40,
      };

      await updateStreamParams(TEST_API_KEY, TEST_STREAM_ID, params);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.daydream.live/v1/streams/${TEST_STREAM_ID}`,
        expect.objectContaining({
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
            'Content-Type': 'application/json',
          },
        })
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.params.prompt).toBe('anime style');
      expect(callBody.params.seed).toBe(123);
      expect(callBody.model_id).toBe('streamdiffusion');
      expect(callBody.pipeline).toBe('live-video-to-video');
    });

    it('should include controlnets in update', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const controlnets = buildControlnetsFromSliders({ pose: 0.5, depth: 0.3 });
      await updateStreamParams(TEST_API_KEY, TEST_STREAM_ID, {
        prompt: 'test',
        controlnets,
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.params.controlnets).toHaveLength(5);
      
      const poseControlnet = callBody.params.controlnets.find(
        (cn: any) => cn.model_id.includes('openpose')
      );
      expect(poseControlnet.conditioning_scale).toBe(0.5);
    });
  });

  describe('deleteStream', () => {
    it('should delete a stream', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await deleteStream(TEST_API_KEY, TEST_STREAM_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.daydream.live/v1/streams/${TEST_STREAM_ID}`,
        expect.objectContaining({
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${TEST_API_KEY}`,
          },
        })
      );
    });

    it('should not throw on 404 (stream already deleted)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(deleteStream(TEST_API_KEY, TEST_STREAM_ID)).resolves.not.toThrow();
    });
  });

  describe('getStreamStatus', () => {
    it('should get stream status', async () => {
      const mockStatus = { id: TEST_STREAM_ID, status: 'active' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStatus),
      });

      const result = await getStreamStatus(TEST_API_KEY, TEST_STREAM_ID);

      expect(result).toEqual(mockStatus);
    });
  });

  describe('buildDefaultControlnets', () => {
    it('should return all 5 controlnets with scale 0', () => {
      const controlnets = buildDefaultControlnets();

      expect(controlnets).toHaveLength(5);
      controlnets.forEach((cn) => {
        expect(cn.conditioning_scale).toBe(0);
        expect(cn.enabled).toBe(true);
        expect(cn.control_guidance_start).toBe(0);
        expect(cn.control_guidance_end).toBe(1);
      });
    });
  });

  describe('buildControlnetsFromSliders', () => {
    it('should map slider values to controlnets', () => {
      const sliders = {
        pose: 0.5,
        edge: 0.3,
        canny: 0,
        depth: 0.8,
        color: 0.1,
      };

      const controlnets = buildControlnetsFromSliders(sliders);

      expect(controlnets).toHaveLength(5);
      
      const poseControlnet = controlnets.find((cn) => cn.model_id.includes('openpose'));
      expect(poseControlnet?.conditioning_scale).toBe(0.5);

      const depthControlnet = controlnets.find((cn) => cn.model_id.includes('depth'));
      expect(depthControlnet?.conditioning_scale).toBe(0.8);
    });

    it('should default missing sliders to 0', () => {
      const sliders = { pose: 0.5 };
      const controlnets = buildControlnetsFromSliders(sliders);

      const edgeControlnet = controlnets.find((cn) => cn.model_id.includes('hed'));
      expect(edgeControlnet?.conditioning_scale).toBe(0);
    });
  });

  describe('CONTROLNETS configuration', () => {
    it('should have all 5 controlnet definitions', () => {
      expect(CONTROLNETS).toHaveLength(5);
      expect(CONTROLNETS.map((cn) => cn.name)).toEqual([
        'pose', 'edge', 'canny', 'depth', 'color',
      ]);
    });
  });

  describe('PRESETS configuration', () => {
    it('should have preset configurations', () => {
      expect(Object.keys(PRESETS)).toContain('anime');
      expect(Object.keys(PRESETS)).toContain('comic');
      expect(Object.keys(PRESETS)).toContain('dream');
      expect(Object.keys(PRESETS)).toContain('neon');

      expect(PRESETS.anime.prompt).toBeDefined();
      expect(PRESETS.anime.controlnets).toBeDefined();
    });
  });
});
