<template>
  <div :class="classNames">
    <div
      v-if="hasSlot('icon')"
      class="dialog-body-icon"
    >
      <slot name="icon" />
    </div>

    <div
      v-if="hasSlot('heading')"
      class="dialog-body-heading"
    >
      <slot name="heading" />
    </div>

    <div class="dialog-body-content">
      <slot />
    </div>
  </div>
</template>

<style lang="scss" scoped>
  @import'../../../assets/tsviewerVariables.scss';

  .dialog-body {
    align-items: center;
    display: flex;
    font-size: 14px;
    flex-direction: column;
    justify-content: center;
    .simple & {
      //padding: 64px 48px;
      text-align: center;
      &.icon {
        //padding: 48px;
      }
    }
  }

  .dialog-body-icon {
    margin-bottom: 8px;
  }

  .dialog-body-heading {
    color: $gray_5;
    font-weight: bold;
    line-height: 16px;
    margin-bottom: 8px;
  }

  .dialog-body-content {
    color: $gray_5;
    line-height: 18px;
    width: 100%;
  }
</style>

<script>
  export default {
    name: 'DialogBody',

    setup(props, { slots }) {
      const hasSlot = name => !!slots[name]
      return { hasSlot }
    },
    props: {
      fixedHeight: {
        type: Boolean,
        default: false
      }
    },

    computed: {
      classNames: function() {
        const hasIcon = this.hasSlot('icon') ? 'icon' : ''
        const fixedHeight = this.fixedHeight ? 'fixed-height' : ''

        return `dialog-body ${hasIcon} ${fixedHeight}`
      }
    }
  }
</script>
