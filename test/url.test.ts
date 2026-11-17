import test from "node:test";
import assert from "node:assert/strict";
import { hostOf, normalizeAccelerateHost, replaceUrlHost } from "../src/utils/url.js";

test("normalizeAccelerateHost 自动补 https", () => {
  assert.equal(normalizeAccelerateHost("cdn.example.com"), "https://cdn.example.com");
  assert.equal(normalizeAccelerateHost("http://cdn.example.com"), "http://cdn.example.com");
  assert.equal(normalizeAccelerateHost("https://cdn.example.com:8443/"), "https://cdn.example.com:8443");
});

test("normalizeAccelerateHost 拒绝路径与非法协议", () => {
  assert.throws(() => normalizeAccelerateHost("https://cdn.example.com/path"));
  assert.throws(() => normalizeAccelerateHost("ftp://cdn.example.com"));
  assert.throws(() => normalizeAccelerateHost("https://"));
  assert.throws(() => normalizeAccelerateHost("https://cdn.example.com?x=1"));
});

test("replaceUrlHost 只替换 host，保留 path/query/签名", () => {
  const signed =
    "https://bucket.s3.us-east-1.amazonaws.com/photos/a.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc";
  const rewritten = replaceUrlHost(signed, "cdn.example.com");
  assert.equal(hostOf(rewritten), "cdn.example.com");
  assert.ok(rewritten.includes("/photos/a.jpg"));
  assert.ok(rewritten.includes("X-Amz-Signature=abc"));
});

test("replaceUrlHost 保留端口", () => {
  const rewritten = replaceUrlHost("https://a.com/x?y=1", "cdn.example.com:8443");
  assert.equal(hostOf(rewritten), "cdn.example.com:8443");
});