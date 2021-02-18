import { GifReader } from "omggif";

const generateArray = (num) => {
  const end = Number(num);
  return [...Array(end).keys()].slice(0);
};

/**
 * * For more on the file format for GIFs
 * * http://www.w3.org/Graphics/GIF/spec-gif89a.txt
 * head : "gifler()"
 * text :
 *  - This is the main entrypoint to the library.
 *  - Prepares and sends an XHR request to load the GIF file.
 *  - Returns a <b>Gif</b> instance for interacting with the library.
 * args :
 *  url : "URL to .gif file"
 * return : "a Gif instance object"
 */
const Gifler = (url) => {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, true);
  xhr.responseType = "arraybuffer";

  const promise = new Promise((resolve, reject) => {
    xhr.onload = (e) => resolve(xhr.response);
  });
  xhr.send();
  return new Gif(promise);
};

class Gif {
  constructor(dataPromise) {
    this.animatorPromise = dataPromise.then((data) => {
      const reader = new GifReader(new Uint8Array(data));
      const decoder = new Decoder();
      return decoder.decodeFramesAsync(reader).then((frames) => {
        console.info("**** gif frames list ****");
        console.info(frames);
        console.info("**** gif frames list ****");
        return new Animator(reader, frames);
      });
    });
  }

  getCanvasElement = (selector) => {
    if (
      typeof selector === "string" &&
      document.querySelector(selector).tagName === "CANVAS"
    ) {
      return document.querySelector(selector);
    } else if (selector.tagName === "CANVAS") {
      return selector;
    } else {
      throw new Error("Unexpected selector type. Valid types are query-selector-string/canvas-element");
    }
  };

  /**
   * head : "gif.animate()"
   * text :
   *  =>
   *    Animates the loaded GIF, drawing each frame into the canvas.
   *    This matches the look of an &lt;img&gt; tag.
   * args :
   *  selector : "A <canvas> element or query selector for a <canvas> element."
   */
  animate = (selector) => {
    this.canvas = this.getCanvasElement(selector);
    return this.animatorPromise.then((animator) => {
      animator.animateInCanvas(canvas);
    });
  };

  /**
   * head : "gif.frames()"
   * text :
   *  =>
   *    Runs the animation on the loaded GIF, but passes the
   *    canvas context and GIF frame to the <b>onDrawFrame</b>
   *    callback for rendering.
   *  =>
   *    This gives you complete control of how the frame is drawn
   *    into the canvas context.
   * args :
   *  selector     : "A <canvas> element or query selector for a <canvas> element."
   *  onDrawFrame  : "A callback that will be invoked when each frame should be drawn into the canvas. see Animator.onDrawFrame."
   *  setDimesions : "OPTIONAL. If true, the canvas""s width/height will be set to the dimension of the loaded GIF. default: false."
   */
  frames = (selector, onDrawFrame, setCanvasDimesions = false) => {
    this.canvas = this.getCanvasElement(selector);
    return this.animatorPromise.then((animator) => {
      animator.onDrawFrame = onDrawFrame;
      animator.animateInCanvas(canvas, setCanvasDimesions);
    });
  };

  /**
   * head : "gif.get()"
   * text :
   *  =>
   *    To get even more control, and for your convenience,
   *    this method returns a promise that will be fulfilled with
   *    an <b>Animator</b> instance. The animator will be in an unstarted state,
   *    but can be started with a call to <b>animator.animateInCanvas()</b>
   */
  get = (callback) => {
    return this._animatorPromise;
  };
}

/**
 * These methods decode the pixels for each frame (decompressing and de-interlacing)
 * into a Uint8ClampedArray, which is suitable for canvas ImageData.
 */
class Decoder {
  decodeFramesSync = (reader) => {
    return generateArray(reader.numFrames()).map((frameIndex) => {
      return this.decodeFrame(reader, frameIndex);
    });
  };

  // decodeFramesAsync = (reader) => {
  //   return Promise.map(generateArray(reader.numFrames()), ((i) => this.decodeFrame(reader, i)), { concurrency: 1 });
  // }

  decodeFramesAsync = (reader) => {
    const frameLength = reader.numFrames();
    const promises = [];
    for (let i = 0; i < frameLength; i++) {
      promises.push(this.decodeFrame(reader, i));
    }
    return Promise.all(promises);
  };

  decodeFrame = (reader, frameIndex) => {
    const frameInfo = reader.frameInfo(frameIndex);
    frameInfo.pixels = new Uint8ClampedArray(reader.width * reader.height * 4);
    reader.decodeAndBlitFrameRGBA(frameIndex, frameInfo.pixels);
    return frameInfo;
  };
}

class Animator {
  constructor(_reader, _frames) {
    this._frames = _frames;
    this.width = _reader.width;
    this.height = _reader.height;
    this._loopCount = _reader.loopCount();
    this._loops = 0;
    this._frameIndex = 0;
    this._running = false;
  }

  /**
   * head : "animator::createBufferCanvas()"
   * text :
   *  =>
   *    Creates a buffer canvas element since it is much faster
   *    to call <b>.putImage()</b> than <b>.putImageData()</b>.
   *  =>
   *    The omggif library decodes the pixels into the full gif
   *    dimensions. We only need to store the frame dimensions,
   *    so we offset the putImageData call.
   * args :
   *  frame  : A frame of the GIF (from the omggif library)
   *  width  : width of the GIF (not the frame)
   *  height : height of the GIF
   * return : A <canvas> element containing the frame's image.
   */
  createBufferCanvas = (frame, width, height) => {
    // Create empty buffer
    const bufferCanvas = document.createElement("canvas");
    const bufferContext = bufferCanvas.getContext("2d");
    bufferCanvas.width = frame.width;
    bufferCanvas.height = frame.height;

    // Create image date from pixels
    const imageData = bufferContext.createImageData(width, height);
    imageData.data.set(frame.pixels);

    // Fill canvas with image data
    bufferContext.putImageData(imageData, -frame.x, -frame.y);
    return bufferCanvas;
  };

  /**
   * head : "animator.start()"
   * text :
   *  - Starts running the GIF animation loop.
   */
  start = () => {
    this._lastTime = new Date().valueOf();
    this._delayCompensation = 0;
    this._running = true;
    setTimeout(() => this._nextFrame(), 0);
    return this;
  };

  /**
   * head : "animator.stop()"
   * text :
   *  - Stops running the GIF animation loop.
   */
  stop = () => {
    this._running = false;
    return this;
  };

  /**
   * head : "animator.reset()"
   * text :
   *  - Resets the animation loop to the first frame.
   *  - Does not stop the animation from running.
   */
  reset = () => {
    this._frameIndex = 0;
    this._loops = 0;
    return this;
  };

  /**
   * head : "animator.running()"
   * return : A boolean indicating whether or not the animation is running.
   */
  running = () => {
    return this._running;
  };

  _nextFrame = () => {
    window.requestAnimationFrame(this._nextFrameRender);
    return;
  };

  _nextFrameRender = () => {
    if (!this._running) {
      return;
    }

    // Render frame with callback.
    const frame = this._frames[this._frameIndex];
    this.onFrame(frame, this._frameIndex);

    this._enqueueNextFrame();
  };

  _advanceFrame = () => {
    // If we are at the end of the animation, either loop or stop.
    this._frameIndex += 1;
    if (this._frameIndex >= this._frames.length) {
      if (this._loopCount !== 0 && this._loopCount === this._loops) {
        this.stop();
      } else {
        this._frameIndex = 0;
        this._loops += 1;
      }
    }
    return;
  };

  _enqueueNextFrame = () => {
    this._advanceFrame();

    while (this._running) {
      const frame = this._frames[this._frameIndex];

      /**
       * Perform frame delay compensation to make sure each frame is drawn at
       * the right time. This helps canvas GIFs match native img GIFs timing.
       */
      const delta = new Date().valueOf() - this._lastTime;
      this._lastTime += delta;
      this._delayCompensation += delta;

      const frameDelay = frame.delay * 10;
      const actualDelay = frameDelay - this._delayCompensation;
      this._delayCompensation -= frameDelay;

      // Skip frames while our frame timeout is negative. This is necessary
      // because browsers such as Chrome will disable javascript while the
      // window is not in focus. When we re-focus the window, it would attempt
      // render all the missed frames as fast as possible.
      if (actualDelay < 0) {
        this._advanceFrame();
        continue;
      } else {
        setTimeout(() => this._nextFrame(), actualDelay);
        break;
      }
    }
    return;
  };

  /**
   * head : "animator.animateInCanvas()"
   * text :
   *  =>
   *    This method prepares the canvas to be drawn into and sets up
   *    the callbacks for each frame while the animation is running.
   *  =>
   *    To change how each frame is drawn into the canvas, override
   *    <b>animator.onDrawFrame()</b> before calling this method.
   *    If <b>animator.onDrawFrame()</b> is not set, we simply draw
   *    the frame directly into the canvas as is.
   *  =>
   *    You may also override <b>animator.onFrame()</b> before calling
   *    this method. onFrame handles the lazy construction of canvas
   *    buffers for each frame as well as the disposal method for each frame.
   *  args :
   *    canvas        : A canvas element.
   *    setDimensions : "OPTIONAL. If true, the canvas width/height will be set to match the GIF. default: true."
   */
  animateInCanvas = (canvas, setDimensions = true) => {
    if (setDimensions) {
      canvas.width = this.width;
      canvas.height = this.height;
    }

    this.ctx = canvas.getContext("2d");

    this.start();
    return this;
  };

  onDrawFrame = (ctx, frame, i) => {
    ctx.drawImage(frame.buffer, frame.x, frame.y);
  };

  onFrame = (frame, i) => {
    // Lazily create canvas buffer.
    frame.buffer = this.createBufferCanvas(frame, this.width, this.height);

    // Handle frame disposal.
    if (this.disposeFrame) {
      this.disposeFrame();
    }
    switch (frame.disposal) {
      case 2:
        this.disposeFrame = () => this.ctx.clearRect(0, 0, canvas.width, canvas.height);
        break;
      case 3:
        const saved = this.ctx.getImageData(0, 0, canvas.width, canvas.height);
        this.disposeFrame = () => this.ctx.putImageData(saved, 0, 0);
        break;
      default:
        this.disposeFrame = null;
    }

    // Draw current frame.
    this.onDrawFrame(this.ctx, frame, i);
  };
}

export default Gifler;
