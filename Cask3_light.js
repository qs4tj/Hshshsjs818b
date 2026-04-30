(() => {
  function _caskClamp(v, lo, hi, def) {
    var n = Number(v);
    if (!isFinite(n)) return def;
    n = Math.floor(n);
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  // Cask 3 config - read from the prelude baked in by pe_main.js at inject time.
  const CASK_STYLE = _caskClamp(globalThis.__cask_style, 0, 15, 11);
  const CASK_DURATION_MS = _caskClamp(globalThis.__cask_duration, 100, 2000, 500);
  
  // Loop interval: 500ms is fast enough to catch scrolling cells, slow enough not to lag.
  const CASK_LOOP_INTERVAL_US = 500000;
  const CASK_LOOP_MAX_ITERS = 21600;

  class Native {
    static #baseAddr;
    static #dlsymAddr;
    static #memcpyAddr;
    static #mallocAddr;
    static mem = 0n;
    static memSize = 0x4000;
    static #argMem = 0n;
    static #argPtr = 0n;
    static #dlsymCache = {};

    static init() {
      const buff = new BigUint64Array(nativeCallBuff);
      this.#baseAddr = buff[20];
      this.#dlsymAddr = buff[21];
      this.#memcpyAddr = buff[22];
      this.#mallocAddr = buff[23];
      this.mem = this.#nativeCallAddr(this.#mallocAddr, BigInt(this.memSize));
      this.#argMem = this.#nativeCallAddr(this.#mallocAddr, 0x1000n);
      this.#argPtr = this.#argMem;
    }

    static write(ptr, buff) {
      if (!ptr) return false;
      const buff8 = new Uint8Array(nativeCallBuff);
      let offs = 0;
      let left = buff.byteLength;
      while (left) {
        let len = left;
        if (len > 0x1000) len = 0x1000;
        buff8.set(new Uint8Array(buff, offs, len), 0x1000);
        this.#nativeCallAddr(this.#memcpyAddr, ptr + BigInt(offs), this.#baseAddr + 0x1000n, BigInt(len));
        left -= len;
        offs += len;
      }
      return true;
    }

    static read(ptr, length) {
      if (!ptr) return null;
      const buff = new ArrayBuffer(length);
      const buff8 = new Uint8Array(buff);
      let offs = 0;
      let left = length;
      while (left) {
        let len = left;
        if (len > 0x1000) len = 0x1000;
        this.#nativeCallAddr(this.#memcpyAddr, this.#baseAddr + 0x1000n, ptr + BigInt(offs), BigInt(len));
        buff8.set(new Uint8Array(nativeCallBuff, 0x1000, len), offs);
        left -= len;
        offs += len;
      }
      return buff;
    }

    static readPtr(ptr) {
      const dv = new DataView(this.read(ptr, 8));
      return dv.getBigUint64(0, true);
    }

    static read32(ptr) {
      const dv = new DataView(this.read(ptr, 4));
      return dv.getUint32(0, true);
    }

    static writeString(ptr, str) {
      this.write(ptr, this.stringToBytes(str, true));
    }

    static readString(ptr, len = 512) {
      return this.bytesToString(this.read(ptr, len), false);
    }

    static bytesToString(bytes, includeNullChar = true) {
      const bytes8 = new Uint8Array(bytes);
      let str = "";
      for (let i = 0; i < bytes8.length; i++) {
        if (!includeNullChar && !bytes8[i]) break;
        str += String.fromCharCode(bytes8[i]);
      }
      return str;
    }

    static stringToBytes(str, nullTerminated = false) {
      const buff = new ArrayBuffer(str.length + (nullTerminated ? 1 : 0));
      const s8 = new Uint8Array(buff);
      for (let i = 0; i < str.length; i++) s8[i] = str.charCodeAt(i);
      if (nullTerminated) s8[str.length] = 0;
      return s8.buffer;
    }

    static #toNative(value) {
      if (!value) return 0n;
      if (typeof value === "string") {
        const ptr = this.#argPtr;
        this.writeString(ptr, value);
        this.#argPtr += BigInt(value.length + 1);
        return ptr;
      }
      if (typeof value === "bigint") return value;
      return BigInt(value);
    }

    static #dlsym(name) {
      if (!name) return 0n;
      let addr = this.#dlsymCache[name];
      if (addr) return addr;
      const RTLD_DEFAULT = 0xfffffffffffffffen;
      const nameBytes = this.stringToBytes(name, true);
      const buff8 = new Uint8Array(nativeCallBuff);
      buff8.set(new Uint8Array(nameBytes), 0x1000);
      addr = this.#nativeCallAddr(this.#dlsymAddr, RTLD_DEFAULT, this.#baseAddr + 0x1000n);
      if (addr) this.#dlsymCache[name] = addr;
      return addr;
    }

    static #nativeCallAddr(addr, x0 = 0n, x1 = 0n, x2 = 0n, x3 = 0n, x4 = 0n, x5 = 0n, x6 = 0n, x7 = 0n) {
      const buff = new BigInt64Array(nativeCallBuff);
      buff[0] = addr;
      buff[100] = x0;
      buff[101] = x1;
      buff[102] = x2;
      buff[103] = x3;
      buff[104] = x4;
      buff[105] = x5;
      buff[106] = x6;
      buff[107] = x7;
      invoker();
      return buff[200];
    }

    static callSymbol(name, x0, x1, x2, x3, x4, x5, x6, x7) {
      this.#argPtr = this.#argMem;
      x0 = this.#toNative(x0);
      x1 = this.#toNative(x1);
      x2 = this.#toNative(x2);
      x3 = this.#toNative(x3);
      x4 = this.#toNative(x4);
      x5 = this.#toNative(x5);
      x6 = this.#toNative(x6);
      x7 = this.#toNative(x7);
      const funcAddr = this.#dlsym(name);
      const ret64 = this.#nativeCallAddr(funcAddr, x0, x1, x2, x3, x4, x5, x6, x7);
      this.#argPtr = this.#argMem;
      if (ret64 < 0xffffffffn && ret64 > -0xffffffffn) return Number(ret64);
      return ret64;
    }

    static bridgeInfo() {
      const buff = new BigUint64Array(nativeCallBuff);
      return {
        jsctx: buff[25],
        jsContextObj: buff[33],
      };
    }
  }

  function u64(v) {
    if (!v) return 0n;
    return BigInt.asUintN(64, BigInt(v));
  }

  function isNonZero(v) {
    return u64(v) !== 0n;
  }

  function log(msg) {
    try {
      const tagged = "[CASK] " + msg;
      const ptr = Native.callSymbol("malloc", BigInt(tagged.length + 1));
      if (!ptr) return;
      Native.writeString(ptr, tagged);
      Native.callSymbol("syslog", 5, ptr);
      Native.callSymbol("free", ptr);
    } catch (_) {}
  }

  function sel(name) {
    return Native.callSymbol("sel_registerName", name);
  }

  function objc(obj, selectorName, ...args) {
    return Native.callSymbol("objc_msgSend", obj, sel(selectorName), ...args);
  }

  function cfstr(str) {
    return Native.callSymbol("CFStringCreateWithCString", 0n, str, 0x08000100);
  }

  function nsStr(str) {
    const NSString = Native.callSymbol("objc_getClass", "NSString");
    return objc(NSString, "stringWithUTF8String:", str);
  }

  // Safe mechanism to construct NSNumber from double without touching FP registers
  let _sharedNumberFormatter = 0n;
  function nsNumberDouble(val) {
    if (!isNonZero(_sharedNumberFormatter)) {
      const NSNumberFormatter = Native.callSymbol("objc_getClass", "NSNumberFormatter");
      const alloc = Native.callSymbol("objc_alloc", NSNumberFormatter);
      _sharedNumberFormatter = objc(alloc, "init");
    }
    return objc(_sharedNumberFormatter, "numberFromString:", nsStr(String(val)));
  }

  function invokeStructSetter(obj, selectorName, bytesBuf) {
    if (!isNonZero(obj)) return false;
    const s = sel(selectorName);
    if (!isNonZero(s)) return false;
    const sig = Native.callSymbol("objc_msgSend", obj, sel("methodSignatureForSelector:"), s);
    if (!isNonZero(sig)) return false;
    const NSInvocation = Native.callSymbol("objc_getClass", "NSInvocation");
    const inv = objc(NSInvocation, "invocationWithMethodSignature:", sig);
    if (!isNonZero(inv)) return false;
    objc(inv, "setTarget:", obj);
    objc(inv, "setSelector:", s);
    const mem = Native.callSymbol("malloc", BigInt(bytesBuf.byteLength));
    Native.write(mem, bytesBuf);
    objc(inv, "setArgument:atIndex:", mem, 2n);
    objc(inv, "invoke");
    Native.callSymbol("free", mem);
    return true;
  }

  function runOnMainEvaluate(script) {
    const jsctxObj = globalThis.__cask_jsctx_obj;
    if (!isNonZero(jsctxObj)) return false;
    const s = cfstr(script);
    objc(jsctxObj, "performSelectorOnMainThread:withObject:waitUntilDone:", sel("evaluateScript:"), s, 0);
    return true;
  }

  function applyCaskAnimation(cell) {
    const ptr = u64(cell);
    if (globalThis.__cask_animated_cells.has(ptr)) return;

    const layer = objc(cell, "layer");
    if (!isNonZero(layer)) return;

    const CAKeyframeAnimation = Native.callSymbol("objc_getClass", "CAKeyframeAnimation");
    const NSArray = Native.callSymbol("objc_getClass", "NSArray");

    let anim = 0n;
    let vals = 0n;

    if (CASK_STYLE === 11) { // Stretch
      anim = objc(CAKeyframeAnimation, "animationWithKeyPath:", nsStr("transform.scale.y"));
      vals = objc(NSArray, "arrayWithObjects:", 
        nsNumberDouble(0.8), nsNumberDouble(1.2), nsNumberDouble(1.0), 0n);
    } else if (CASK_STYLE === 13) { // Swing
      anim = objc(CAKeyframeAnimation, "animationWithKeyPath:", nsStr("transform.translation.x"));
      vals = objc(NSArray, "arrayWithObjects:", 
        nsNumberDouble(0), nsNumberDouble(40), nsNumberDouble(-50), nsNumberDouble(30), nsNumberDouble(0), 0n);
    } else if (CASK_STYLE === 1) { // Fade
      anim = objc(CAKeyframeAnimation, "animationWithKeyPath:", nsStr("opacity"));
      vals = objc(NSArray, "arrayWithObjects:", 
        nsNumberDouble(0.0), nsNumberDouble(1.0), 0n);
    } else {
      // Default: Stretch
      anim = objc(CAKeyframeAnimation, "animationWithKeyPath:", nsStr("transform.scale.y"));
      vals = objc(NSArray, "arrayWithObjects:", 
        nsNumberDouble(0.8), nsNumberDouble(1.2), nsNumberDouble(1.0), 0n);
    }

    if (isNonZero(anim) && isNonZero(vals)) {
      objc(anim, "setValues:", vals);
      
      const durBuf = new ArrayBuffer(8);
      new DataView(durBuf).setFloat64(0, CASK_DURATION_MS / 1000.0, true);
      invokeStructSetter(anim, "setDuration:", durBuf);
      
      objc(layer, "addAnimation:forKey:", anim, nsStr("caskAnim"));
    }
    
    globalThis.__cask_animated_cells.add(ptr);
  }

  function walkFindTableViews(view, tableViewCls, depth, visited) {
    if (depth > 12) return;
    if (!isNonZero(view)) return;
    visited[0]++;
    
    if (isNonZero(objc(view, "isKindOfClass:", tableViewCls))) {
      const cells = objc(view, "visibleCells");
      if (isNonZero(cells)) {
        const count = Number(u64(objc(cells, "count")));
        const lim = count < 20 ? count : 20;
        for (let i = 0; i < lim; i++) {
          const cell = objc(cells, "objectAtIndex:", BigInt(i));
          if (isNonZero(cell)) applyCaskAnimation(cell);
        }
      }
      return; 
    }
    
    const subs = objc(view, "subviews");
    if (!isNonZero(subs)) return;
    const cnt = Number(u64(objc(subs, "count")));
    if (cnt <= 0) return;
    const lim = cnt < 64 ? cnt : 64;
    for (let i = 0; i < lim; i++) {
      const sub = objc(subs, "objectAtIndex:", BigInt(i));
      if (isNonZero(sub)) {
        walkFindTableViews(sub, tableViewCls, depth + 1, visited);
      }
    }
  }

  function doCaskPass() {
    const UIApplication = Native.callSymbol("objc_getClass", "UIApplication");
    if (!isNonZero(UIApplication)) return;
    const app = objc(UIApplication, "sharedApplication");
    if (!isNonZero(app)) return;
    
    const keyWin = objc(app, "keyWindow");
    if (!isNonZero(keyWin)) return;

    const tableViewCls = Native.callSymbol("objc_getClass", "UITableView");
    if (!isNonZero(tableViewCls)) return;

    const visited = [0];
    walkFindTableViews(keyWin, tableViewCls, 0, visited);
  }

  try {
    log("=== cask3_light.js entry ===");
    Native.init();
    
    const bi = Native.bridgeInfo();
    globalThis.__cask_jsctx_obj = bi.jsContextObj;
    globalThis.__cask_pass = doCaskPass;
    
    if (!globalThis.__cask_animated_cells) {
      globalThis.__cask_animated_cells = new Set();
    }

    log("cask: entering repeat loop (interval=" + CASK_LOOP_INTERVAL_US + "us)");
    globalThis.__cask_loop_active = true;
    let tick = 0;
    
    while (globalThis.__cask_loop_active && tick < CASK_LOOP_MAX_ITERS) {
      Native.callSymbol("usleep", BigInt(CASK_LOOP_INTERVAL_US));
      try {
        runOnMainEvaluate("try{__cask_pass();}catch(e){}");
      } catch (e) {
        log("cask loop post err: " + String(e));
      }
      tick++;
    }
    log("cask: loop exited after " + tick + " ticks");
    
  } catch (e) {
    log("fatal: " + String(e));
  }
})();
