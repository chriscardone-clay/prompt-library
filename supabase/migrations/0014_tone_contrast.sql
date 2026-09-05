-- Two catalog inks fell short of WCAG AA (4.5:1) on their own light tints:
-- ChatGPT #808000 on #FCFEE2 was 4.1:1 and Claygent #008BAD on #F0FCFF was
-- 3.9:1. Darken both one step, keeping the hue. Admins can change these any
-- time in /admin; dark mode derives its own pair from the ink.
update public.apps set fg = '#6B7000' where name = 'ChatGPT' and fg = '#808000';
update public.apps set fg = '#00748F' where name = 'Claygent' and fg = '#008BAD';
