/**
 * 金羽夜枭品牌图标：猫头鹰面罩与点划电码合为一个紧凑线性符号。
 * 接口与 lucide-react 图标一致，可直接用于导航和按钮。
 */
const SignalOwlIcon = ({ size = 24, strokeWidth = 1.8, className = '', style, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={style}
    aria-hidden="true"
    {...props}
  >
    <path d="M5.2 8.2 4.4 3.8l4.1 2.1A8.2 8.2 0 0 1 12 5.1a8.2 8.2 0 0 1 3.5.8l4.1-2.1-.8 4.4c.8 1.2 1.2 2.7 1.2 4.2 0 4.4-3.6 7.2-8 7.2s-8-2.8-8-7.2c0-1.5.4-3 1.2-4.2Z" />
    <path d="M7.2 10.2c1.2-1.1 2.6-1.1 3.8.1M16.8 10.2c-1.2-1.1-2.6-1.1-3.8.1" />
    <circle cx="8.8" cy="12.3" r="1.25" />
    <circle cx="15.2" cy="12.3" r="1.25" />
    <path d="m10.7 15 1.3 1.1 1.3-1.1" />
    <circle cx="8.2" cy="21.6" r=".7" fill="currentColor" stroke="none" />
    <path d="M11.2 21.6h4.7" />
  </svg>
);

export default SignalOwlIcon;
