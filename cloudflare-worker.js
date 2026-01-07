// Cloudflare Worker for routing a.com/why_are_you_like_this to Render
// Replace YOUR_RENDER_URL with your actual Render URL (e.g., why-are-you-like-this.onrender.com)

const RENDER_URL = 'YOUR_RENDER_URL.onrender.com';
const BASE_PATH = '/why_are_you_like_this';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // Only handle requests to /why_are_you_like_this/*
    if (!url.pathname.startsWith(BASE_PATH)) {
      // Return 404 or pass through to origin for other paths
      return new Response('Not Found', { status: 404 });
    }
    
    // Remove the base path prefix for the backend
    let backendPath = url.pathname.slice(BASE_PATH.length) || '/';
    
    // Build the backend URL
    const backendUrl = new URL(backendPath, `https://${RENDER_URL}`);
    backendUrl.search = url.search;
    
    // Handle WebSocket upgrade requests
    if (request.headers.get('Upgrade') === 'websocket') {
      return fetch(backendUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
    }
    
    // Forward the request to Render
    const response = await fetch(backendUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    
    // Clone response and modify if needed
    const modifiedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    
    return modifiedResponse;
  },
};


