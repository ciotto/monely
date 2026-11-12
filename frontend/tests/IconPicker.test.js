import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";

import CategoryIcon from "@/components/CategoryIcon.vue";
import IconPicker from "@/components/IconPicker.vue";
import { i18n, setLocale } from "@/i18n";
import { CATEGORY_ICONS } from "@/icons";

function mountPicker(modelValue = "") {
  const wrapper = mount(IconPicker, {
    props: { modelValue, name: "icon", "onUpdate:modelValue": (value) => wrapper.setProps({ modelValue: value }) },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  return wrapper;
}

describe("IconPicker", () => {
  beforeEach(() => setLocale("en"));

  it("lists the curated icons with their translated names", async () => {
    const wrapper = mountPicker("house");
    const toggle = wrapper.find("button[name=icon]");
    expect(toggle.attributes("aria-expanded")).toBe("false");

    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    const options = wrapper.findAll("button[data-icon]");
    expect(options.map((option) => option.attributes("data-icon"))).toEqual(["", ...Object.keys(CATEGORY_ICONS)]);
    expect(options.every((option) => option.attributes("aria-label"))).toBe(true);
    expect(wrapper.find("button[data-icon=house]").attributes()).toMatchObject({
      title: "Home",
      "aria-pressed": "true",
    });
    expect(wrapper.find("button[data-icon='']").attributes("aria-label")).toBe("No icon");
    wrapper.unmount();
  });

  it("chooses an icon and closes the panel", async () => {
    const wrapper = mountPicker();
    await wrapper.find("button[name=icon]").trigger("click");
    expect(wrapper.find("button[data-icon='']").attributes("aria-pressed")).toBe("true");

    await wrapper.find("button[data-icon=car]").trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([["car"]]);
    expect(wrapper.find("button[data-icon]").exists()).toBe(false);

    await wrapper.find("button[name=icon]").trigger("click");
    await wrapper.find("button[data-icon='']").trigger("click");
    expect(wrapper.props("modelValue")).toBe("");
    wrapper.unmount();
  });

  it("toggles the panel from its button and closes it with escape", async () => {
    const wrapper = mountPicker();
    const toggle = wrapper.find("button[name=icon]");
    await toggle.trigger("click");
    await toggle.trigger("click");
    expect(wrapper.find("button[data-icon]").exists()).toBe(false);

    await toggle.trigger("click");
    await wrapper.find("button[data-icon=car]").trigger("keydown", { key: "Escape" });
    expect(wrapper.find("button[data-icon]").exists()).toBe(false);
    wrapper.unmount();
  });

  it("closes the panel only when the focus leaves the picker", async () => {
    const wrapper = mountPicker();
    const toggle = wrapper.find("button[name=icon]");
    await toggle.trigger("click");

    await toggle.trigger("focusout", { relatedTarget: wrapper.find("button[data-icon=car]").element });
    expect(wrapper.find("button[data-icon]").exists()).toBe(true);

    await toggle.trigger("focusout", { relatedTarget: document.body });
    expect(wrapper.find("button[data-icon]").exists()).toBe(false);
    wrapper.unmount();
  });
});

describe("CategoryIcon", () => {
  it("renders nothing for names outside the curated set", () => {
    expect(
      mount(CategoryIcon, { props: { name: "unknown" } })
        .find("svg")
        .exists(),
    ).toBe(false);
  });
});
