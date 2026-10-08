# docs —— 演示素材

README「演示」一节用的是这里的三个**动图 WebP**（GitHub 正常显示动画，体积比 GIF 小约 86%）：

| 文件 | 内容 |
|---|---|
| `demo-overview.webp` | 喂饭 + 干活敲键盘同时进行（首图） |
| `demo-feed.webp` | 不干活时喂饭：拖到鲸鱼身上 → 吃掉 → 冒台词（含空碗续饭） |
| `demo-typing.webp` | 干活时敲键盘 + 露手 + 工具名吐司 |

## 想重录或替换

1. 录一段 GIF（**只录挂件附近**，≤10 秒；Windows 可用 `Win+G` 或 ScreenToGif）
2. 用 ffmpeg 转成动图 WebP（体积能小一个数量级）：

   ```bash
   ffmpeg -i input.gif -vf "fps=12,scale=420:-1:flags=lanczos" \
          -c:v libwebp -lossless 0 -q:v 62 -compression_level 6 -loop 0 -an demo-feed.webp
   ```

3. 覆盖同名文件即可，README 不用动。（想再小一点就调低 `fps` / `scale` / `-q:v`）
