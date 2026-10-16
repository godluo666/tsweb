import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBBCode } from '../web/bbcode.js';

test('频道音乐指令手册显示嵌套居中、粗体、颜色，保留换行和命令参数', () => {
  const description = `[center][b][color=orange]🎵 音乐机器人指令手册 🎵[/color][/b][/center]
[center][color=gray]📌 命令前缀默认为 !（可在设置更改）。[/color][/center]
[center][color=gray]💡 快捷别名：!p = 播放 | !n = 下一首 | !s = 跳过[/color][/center]

[b][color=deepskyblue]▶️ 【基础播放】[/color][/b]
• [b][color=tomato]!play[/color][/b] [color=lightgreen]<歌名>[/color]：搜索并播放（默认网易云最热项）
• [b][color=tomato]!vol[/color][/b] [color=lightgreen]<0-100>[/color]：调整机器人音量`;
  const html = renderBBCode(description);
  assert.ok(html.startsWith('<span class="bb-align bb-center"><strong><span style="color:orange">🎵 音乐机器人指令手册 🎵</span></strong></span>\n'));
  assert.ok(html.includes('\n\n<strong><span style="color:deepskyblue">▶️ 【基础播放】</span></strong>\n'));
  assert.ok(html.includes('• <strong><span style="color:tomato">!play</span></strong> <span style="color:lightgreen">&lt;歌名&gt;</span>'));
  assert.ok(html.includes('<span style="color:lightgreen">&lt;0-100&gt;</span>'));
  assert.equal(html.split('\n').length, description.split('\n').length);
  assert.doesNotMatch(html, /\[\/?(?:b|center|color)(?:=|\])/);
});

test('常用标签可嵌套、重复使用并接受大小写和带引号的颜色', () => {
  assert.equal(renderBBCode('[B][i][u][s]文字[/s][/u][/i][/B]'), '<strong><em><u><s>文字</s></u></em></strong>');
  assert.equal(renderBBCode('[b]外[b]内[/b]外[/b]'), '<strong>外<strong>内</strong>外</strong>');
  assert.equal(renderBBCode('[left]左[/left][right]右[/right]'), '<span class="bb-align bb-left">左</span><span class="bb-align bb-right">右</span>');
  assert.equal(renderBBCode('[color="#F80"]橙色[/color]'), '<span style="color:#F80">橙色</span>');
});

test('纯文本、未闭合标签和不支持的标签保持可读', () => {
  assert.equal(renderBBCode('第一行\r\n第二行\r第三行'), '第一行\n第二行\n第三行');
  assert.equal(renderBBCode('[b]未闭合 [i]斜体[/i]'), '[b]未闭合 <em>斜体</em>');
  assert.equal(renderBBCode('[/b][size=18]标题[/size]'), '[/b][size=18]标题[/size]');
  assert.equal(renderBBCode('[b=x]文字[/b]'), '[b=x]文字[/b]');
});

test('网页链接可以包含格式和查询参数，裸 url 标签也能打开', () => {
  assert.equal(renderBBCode('[url="https://example.com/?a=1&b=2"][b]帮助[/b][/url]'), '<a href="https://example.com/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"><strong>帮助</strong></a>');
  assert.equal(renderBBCode('[url]http://example.com/help[/url]'), '<a href="http://example.com/help" target="_blank" rel="noopener noreferrer">http://example.com/help</a>');
});

test('频道描述的 HTML、颜色属性和非网页链接不能变成可执行内容', () => {
  assert.equal(renderBBCode('<img src=x onerror="alert(1)"> & <script>alert(1)</script>'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(renderBBCode('[color=red;position:fixed]文字[/color]'), '[color=red;position:fixed]文字[/color]');
  assert.equal(renderBBCode('[color=red" onclick="alert(1)]文字[/color]'), '[color=red&quot; onclick=&quot;alert(1)]文字[/color]');
  assert.equal(renderBBCode('[url=javascript:alert(1)]点击[/url]'), '[url=javascript:alert(1)]点击[/url]');
  assert.equal(renderBBCode('[url]data:text/html,<script>alert(1)</script>[/url]'), '[url]data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;[/url]');
  assert.equal(renderBBCode('[url=https://example.com/"onclick="alert(1)]点击[/url]'), '<a href="https://example.com/%22onclick=%22alert(1)" target="_blank" rel="noopener noreferrer">点击</a>');
});
