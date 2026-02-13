# Daydream AI Video Plugin

Real-time AI video transformation using the Daydream.live StreamDiffusion API.

## Features

- **Webcam Input**: Stream your webcam via WebRTC WHIP
- **AI Transformation**: Real-time video transformation using Stable Diffusion
- **Fun Controls**: Colorful parameter sliders and preset buttons
- **Low Latency Output**: WebRTC playback via lvpr.tv iframe
- **Usage Tracking**: Track session count and duration

## Quick Start

1. Get an API key from [Daydream Dashboard](https://app.daydream.live/dashboard/api-keys)
2. Install the plugin from the Marketplace
3. Go to Settings and enter your API key
4. Start streaming!

## Controls

### Main Parameters
- **Prompt**: Describe what you want to transform into
- **Seed**: Random seed for reproducible results
- **Negative Prompt**: What to avoid in generation

### ControlNets
- **Pose**: Body/hand tracking
- **Edge (HED)**: Soft edge preservation
- **Canny**: Sharp edge detection
- **Depth**: 3D structure preservation
- **Color**: Palette preservation

### Quick Presets
- **Anime Me**: Face transformation preset
- **Comic Book**: Sharp edges + color
- **Dream Mode**: Soft edges + depth
- **Neon Glow**: High contrast effects

## API Documentation

See [Daydream.live Docs](https://docs.daydream.live/introduction)

## Development

```bash
# Install dependencies
cd plugins/daydream-video
npm install

# Run frontend dev server
cd frontend && npm run dev

# Run backend dev server
cd backend && npm run dev
```

## Building

```bash
cd frontend && npm run build
cd backend && npm run build
```

## License

MIT
