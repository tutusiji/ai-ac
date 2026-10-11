"use strict";
// 运镜 → zoompan 滤镜表达式(spec §3.1):固定返回 null(静止画面),
// 缓推与未知值保持现行 kenburns 行为;W/H/fps 由调用方传入,本模块零依赖。
function cameraExpr(camera, frames, W, H, fps) {
  const tail = `:d=${frames}:s=${W}x${H}:fps=${fps}`;
  if (camera === "固定") return null;
  if (camera === "拉远")
    return `zoompan=z='max(1,1.14-0.12*on/${frames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'${tail}`;
  if (camera === "摇镜")
    return `zoompan=z='1.15':x='(iw-iw/zoom)*on/${frames}':y='(ih-ih/zoom)/2'${tail}`;
  if (camera === "特写")
    return `zoompan=z='min(1.3,1+0.28*on/${frames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'${tail}`;
  return `zoompan=z='min(1.14,1+0.12*on/${frames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'${tail}`;
}

module.exports = { cameraExpr };
